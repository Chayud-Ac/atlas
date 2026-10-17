// One environment's platform: network, logs, workload identities, the Container Apps environment
// and Postgres (spec §4, §6.4, §7, §8.4). migrate.bicep and apps.bicep deploy on top of it and find
// these resources by name.
targetScope = 'resourceGroup'

@description('The environment: a key of environments.json.')
@allowed(['dev'])
param environmentName string

@description('Object id of the atlas-{env}-db-admins Entra group: the people who may administer Postgres.')
param dbAdminGroupObjectId string

@description('Display name of the atlas-{env}-db-admins Entra group.')
param dbAdminGroupName string

var config = loadJsonContent('config/environments.json')
var env = config.environments[environmentName]
var location = env.location
var tags = union(config.tags, { env: environmentName })
var suffix = uniqueString(subscription().id)

// ---- Network (spec §7) ----

resource caeNsg 'Microsoft.Network/networkSecurityGroups@2025-07-01' = {
  name: 'nsg-atlas-${environmentName}-cae'
  location: location
  tags: tags
}

resource psqlNsg 'Microsoft.Network/networkSecurityGroups@2025-07-01' = {
  name: 'nsg-atlas-${environmentName}-psql'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'allow-postgres-from-cae'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: env.network.caeSubnet
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '5432'
        }
      }
    ]
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2025-07-01' = {
  name: 'vnet-atlas-${environmentName}'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: [env.network.addressSpace] }
    subnets: [
      {
        name: 'snet-cae'
        properties: {
          addressPrefix: env.network.caeSubnet
          networkSecurityGroup: { id: caeNsg.id }
          delegations: [
            { name: 'container-apps', properties: { serviceName: 'Microsoft.App/environments' } }
          ]
        }
      }
      {
        // Reserved in dev, which keeps Postgres public, so dev can move to private networking later.
        name: 'snet-psql'
        properties: {
          addressPrefix: env.network.psqlSubnet
          networkSecurityGroup: { id: psqlNsg.id }
          delegations: [
            { name: 'postgres', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }
          ]
        }
      }
    ]
  }
}

// ---- Logs ----

resource logs 'Microsoft.OperationalInsights/workspaces@2026-03-01' = {
  name: 'log-atlas-${environmentName}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: env.logRetentionDays
  }
}

// ---- Workload identities (spec §6.4): user-assigned, so AcrPull exists before the first pull ----

resource webIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: 'id-atlas-web-${environmentName}'
  location: location
  tags: tags
}

resource apiIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: 'id-atlas-api-${environmentName}'
  location: location
  tags: tags
}

resource migratorIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: 'id-atlas-migrator-${environmentName}'
  location: location
  tags: tags
}

module acrPull 'modules/acr-pull.bicep' = {
  name: 'acr-pull-${environmentName}'
  scope: resourceGroup(config.shared.resourceGroup)
  params: {
    registryName: 'cratlas${suffix}'
    principalIds: [
      webIdentity.properties.principalId
      apiIdentity.properties.principalId
      migratorIdentity.properties.principalId
    ]
  }
}

// ---- Container Apps environment (spec §7): VNet-integrated, external so the web app is public ----

resource cae 'Microsoft.App/managedEnvironments@2026-07-01' = {
  name: 'cae-atlas-${environmentName}'
  location: location
  tags: tags
  properties: {
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
    vnetConfiguration: {
      infrastructureSubnetId: resourceId('Microsoft.Network/virtualNetworks/subnets', vnet.name, 'snet-cae')
      internal: false
    }
    // Logs go to Log Analytics through the diagnostic setting below, not a workspace shared key.
    appLogsConfiguration: { destination: 'azure-monitor' }
  }
}

// The newest version with categoryGroup ('allLogs'); 2016-09-01 can only list categories one by one.
#disable-next-line use-recent-api-versions
resource caeLogs 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: cae
  properties: {
    workspaceId: logs.id
    logs: [{ categoryGroup: 'allLogs', enabled: true }]
  }
}

// ---- Postgres (spec §8.4): Entra authentication only, no password exists ----

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' = {
  name: 'psql-atlas-${environmentName}-${suffix}'
  location: location
  tags: tags
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '17'
    storage: { storageSizeGB: 32, autoGrow: 'Disabled' }
    backup: { backupRetentionDays: env.postgres.backupRetentionDays, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: { publicNetworkAccess: env.postgres.publicAccess ? 'Enabled' : 'Disabled' }
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
      tenantId: tenant().tenantId
    }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2025-08-01' = {
  parent: postgres
  name: 'atlas'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

// Dev only: lets Azure services (the Container Apps environment's outbound traffic) connect. A
// developer's IP is added on demand. Postgres takes one change at a time, hence the dependsOn chain.
resource allowAzureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2025-08-01' = if (env.postgres.publicAccess) {
  parent: postgres
  name: 'AllowAllAzureServicesAndResourcesWithinAzureIps'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
  dependsOn: [database]
}

module postgresAdmins 'modules/postgres-admins.bicep' = {
  name: 'postgres-admins-${environmentName}'
  params: {
    serverName: postgres.name
    migratorPrincipalId: migratorIdentity.properties.principalId
    migratorName: migratorIdentity.name
    groupObjectId: dbAdminGroupObjectId
    groupName: dbAdminGroupName
  }
  dependsOn: [database, allowAzureServices]
}
