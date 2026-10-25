// A stage's alerts (spec §11.2, prod only): an availability test of the public health check,
// and log alerts for API server errors and failed migrations. All email ALERT_EMAIL.
targetScope = 'resourceGroup'

@description('The environment: a key of environments.json.')
param environmentName string

@description('Where alerts are emailed (the ALERT_EMAIL secret).')
param alertEmail string

@description('The public URL the availability test requests.')
param healthUrl string

var config = loadJsonContent('../config/environments.json')
var location = config.environments[environmentName].location
var tags = union(config.tags, { env: environmentName })
var name = 'atlas-${environmentName}'

resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: 'appi-${name}'
}

resource logs 'Microsoft.OperationalInsights/workspaces@2026-03-01' existing = {
  name: 'log-${name}'
}

// Container Apps writes every stage's job events here (ADR 0017).
resource sharedLogs 'Microsoft.OperationalInsights/workspaces@2026-03-01' existing = {
  name: 'log-atlas-shared'
  scope: resourceGroup(config.shared.resourceGroup)
}

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-${name}'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: name
    enabled: true
    emailReceivers: [{ name: 'owner', emailAddress: alertEmail, useCommonAlertSchema: true }]
  }
}

// One request every 15 minutes from 3 locations. It goes through nginx to the API and Postgres,
// for about $6 a month (two tests every 5 minutes would be about $38).
resource availability 'Microsoft.Insights/webtests@2022-06-15' = {
  name: 'avail-${name}-health'
  location: location
  // Azure requires this tag: it links the test to its App Insights.
  tags: union(tags, { 'hidden-link:${appInsights.id}': 'Resource' })
  kind: 'standard'
  properties: {
    SyntheticMonitorId: 'avail-${name}-health'
    Name: 'Health check (${environmentName})'
    Kind: 'standard'
    Enabled: true
    Frequency: 900
    Timeout: 30
    // A location reports a failure only after three attempts in a row fail.
    RetryEnabled: true
    Locations: [
      { Id: 'apac-jp-kaw-edge' } // Japan East
      { Id: 'apac-sg-sin-azr' } // Southeast Asia
      { Id: 'apac-hk-hkn-azr' } // East Asia
    ]
    Request: { RequestUrl: healthUrl, HttpVerb: 'GET', ParseDependentRequests: false }
    ValidationRules: { ExpectedHttpStatusCode: 200, SSLCheck: true, SSLCertRemainingLifetimeCheck: 7 }
  }
}

// Two failed locations, not one, so one location's network trouble doesn't page anyone.
resource availabilityAlert 'Microsoft.Insights/metricAlerts@2026-01-01' = {
  name: 'alert-${name}-availability'
  location: 'global'
  tags: tags
  properties: {
    description: 'The ${environmentName} health check fails from 2 or more locations.'
    severity: 1
    enabled: true
    scopes: [availability.id, appInsights.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.WebtestLocationAvailabilityCriteria'
      webTestId: availability.id
      componentId: appInsights.id
      failedLocationCount: 2
    }
    actions: [{ actionGroupId: actionGroup.id }]
  }
}

resource apiErrorsAlert 'Microsoft.Insights/scheduledQueryRules@2026-03-01' = {
  name: 'alert-${name}-api-errors'
  location: location
  tags: tags
  properties: {
    description: 'More than 5 API requests failed with a server error in 5 minutes.'
    severity: 2
    enabled: true
    scopes: [logs.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    criteria: {
      allOf: [
        {
          // Server errors only: a 4xx is the caller's mistake (an expired token is a 401).
          query: 'AppRequests | where AppRoleName == "atlas-api" and toint(ResultCode) >= 500'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 5
          failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
        }
      ]
    }
    autoMitigate: true
    actions: { actionGroups: [actionGroup.id] }
  }
}

// Every 15 minutes, over 30, so a late-arriving event still lands in a window. The pipeline
// already fails a deploy whose migration fails; this also catches manual runs.
resource migrationAlert 'Microsoft.Insights/scheduledQueryRules@2026-03-01' = {
  name: 'alert-${name}-migration'
  location: location
  tags: tags
  properties: {
    description: 'A migration job execution exited with a non-zero code.'
    severity: 1
    enabled: true
    scopes: [sharedLogs.id]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT30M'
    criteria: {
      allOf: [
        {
          // Container Apps logs each exit twice: "exit code: 0," and "exit code '0'".
          query: 'ContainerAppSystemLogs | where JobName == "caj-atlas-migrate-${environmentName}" | where Log has "exit code" and not(Log contains "exit code: 0," or Log contains "exit code \'0\'")'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
        }
      ]
    }
    autoMitigate: true
    actions: { actionGroups: [actionGroup.id] }
  }
}
