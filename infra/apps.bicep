// The API and web container apps (spec §4, §10, §15). They use the platform's resources, found by name.
targetScope = 'resourceGroup'

@description('The environment: a key of environments.json.')
@allowed(['dev', 'uat', 'prod'])
param environmentName string

@description('The image tag to run: the git SHA that was built and pushed.')
param imageTag string

@description('The Entra tenant of the app registrations.')
param entraTenantId string

@description('Client id of the atlas-{env}-web app registration.')
param webClientId string

@description('Client id of the atlas-{env}-api app registration: the audience of access tokens.')
param apiClientId string

var config = loadJsonContent('config/environments.json')
var env = config.environments[environmentName]
var tags = union(config.tags, { env: environmentName })
var resources = { cpu: json('0.25'), memory: '0.5Gi' }
var scale = {
  minReplicas: env.replicas.min
  maxReplicas: env.replicas.max
  rules: [{ name: 'http', http: { metadata: { concurrentRequests: '50' } } }]
}

// The subscription's one Container Apps environment, shared by every stage (ADR 0017).
resource cae 'Microsoft.App/managedEnvironments@2026-07-01' existing = {
  name: 'cae-atlas'
  scope: resourceGroup(config.shared.resourceGroup)
}

resource webIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = {
  name: 'id-atlas-web-${environmentName}'
}

resource apiIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = {
  name: 'id-atlas-api-${environmentName}'
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' existing = {
  name: 'psql-atlas-${environmentName}-${uniqueString(subscription().id)}'
}

resource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' existing = {
  name: 'cratlas${uniqueString(subscription().id)}'
  scope: resourceGroup(config.shared.resourceGroup)
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: 'appi-atlas-${environmentName}'
}

resource api 'Microsoft.App/containerApps@2026-07-01' = {
  name: 'ca-atlas-api-${environmentName}'
  location: env.location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${apiIdentity.id}': {} }
  }
  properties: {
    environmentId: cae.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        // Internal only: reachable from inside the environment, never from the internet.
        external: false
        targetPort: 3000
        transport: 'http'
        // nginx in the web app calls http://ca-atlas-api-{env}. Without this, that call would be
        // redirected to https. The traffic never leaves the environment.
        allowInsecure: true
      }
      registries: [{ server: registry.properties.loginServer, identity: apiIdentity.id }]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: '${registry.properties.loginServer}/atlas-api:${imageTag}'
          resources: resources
          env: [
            { name: 'ATLAS_ENV', value: environmentName }
            { name: 'APP_VERSION', value: imageTag }
            { name: 'LOG_LEVEL', value: 'info' }
            { name: 'OIDC_ISSUER', value: '${environment().authentication.loginEndpoint}${entraTenantId}/v2.0' }
            { name: 'OIDC_AUDIENCE', value: apiClientId }
            { name: 'DB_AUTH', value: 'entra' }
            { name: 'PGHOST', value: postgres.properties.fullyQualifiedDomainName }
            { name: 'PGDATABASE', value: 'atlas' }
            { name: 'PGUSER', value: apiIdentity.name }
            { name: 'AZURE_CLIENT_ID', value: apiIdentity.properties.clientId }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
            // The cloud role name in App Insights, and the version that served each request.
            { name: 'OTEL_SERVICE_NAME', value: 'atlas-api' }
            { name: 'OTEL_RESOURCE_ATTRIBUTES', value: 'service.version=${imageTag}' }
          ]
          probes: [
            { type: 'Liveness', httpGet: { path: '/api/health/live', port: 3000 }, periodSeconds: 10 }
            { type: 'Readiness', httpGet: { path: '/api/health/ready', port: 3000 }, periodSeconds: 10 }
          ]
        }
      ]
      scale: scale
    }
  }
}

resource web 'Microsoft.App/containerApps@2026-07-01' = {
  name: 'ca-atlas-web-${environmentName}'
  location: env.location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${webIdentity.id}': {} }
  }
  properties: {
    environmentId: cae.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      // Public, HTTPS only: plain http is redirected.
      ingress: { external: true, targetPort: 8080, transport: 'auto', allowInsecure: false }
      registries: [{ server: registry.properties.loginServer, identity: webIdentity.id }]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: '${registry.properties.loginServer}/atlas-web:${imageTag}'
          resources: resources
          // Rendered into /config.json by nginx at start (ADR 0016).
          env: [
            { name: 'ATLAS_ENV', value: environmentName }
            { name: 'AUTH_KIND', value: 'msal' }
            { name: 'AUTH_AUTHORITY', value: '${environment().authentication.loginEndpoint}${entraTenantId}' }
            { name: 'AUTH_CLIENT_ID', value: webClientId }
            { name: 'AUTH_API_SCOPE', value: 'api://${apiClientId}/access_as_user' }
            { name: 'API_UPSTREAM', value: api.name }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
          ]
          probes: [{ type: 'Liveness', httpGet: { path: '/', port: 8080 }, periodSeconds: 10 }]
        }
      ]
      scale: scale
    }
  }
}

output webFqdn string = web.properties.configuration.ingress.fqdn
