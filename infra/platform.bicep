// One environment's own resources: workload identities and Postgres (spec §6.4, §8.4). Compute is
// shared: the environment's apps and migration job run in rg-atlas-shared's one Container Apps
// environment (ADR 0017). migrate.bicep and apps.bicep deploy on top and find these by name.
targetScope = 'resourceGroup'

@description('The environment: a key of environments.json.')
@allowed(['dev', 'uat', 'prod'])
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

// ---- Postgres (spec §8.4): Entra authentication only, no password exists ----

resource sharedVnet 'Microsoft.Network/virtualNetworks@2025-07-01' existing = {
  name: 'vnet-atlas-shared'
  scope: resourceGroup(config.shared.resourceGroup)
}

// UAT and prod (ADR 0008): Postgres sits in its own subnet of the shared VNet, with no public
// endpoint. This zone, linked to that VNet, resolves the server's name to its private address.
resource postgresDns 'Microsoft.Network/privateDnsZones@2024-06-01' = if (!env.postgres.publicAccess) {
  name: 'atlas-${environmentName}.private.postgres.database.azure.com'
  location: 'global'
  tags: tags
}

resource postgresDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = if (!env.postgres.publicAccess) {
  parent: postgresDns
  name: sharedVnet.name
  location: 'global'
  tags: tags
  properties: {
    virtualNetwork: { id: sharedVnet.id }
    registrationEnabled: false
  }
}

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
    // Fixed when the server is created: a public server can't become private later.
    network: env.postgres.publicAccess
      ? { publicNetworkAccess: 'Enabled' }
      : {
          publicNetworkAccess: 'Disabled'
          delegatedSubnetResourceId: '${sharedVnet.id}/subnets/snet-psql-${environmentName}'
          privateDnsZoneArmResourceId: postgresDns.id
        }
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
      tenantId: tenant().tenantId
    }
  }
  // The zone must be linked to the VNet before a private server is created in it.
  dependsOn: [postgresDnsLink]
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
