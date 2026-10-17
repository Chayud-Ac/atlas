// The migration job (ADR 0006): the API image with the migrate command, started by the pipeline
// before every API deploy. It uses the platform's resources, found by name.
targetScope = 'resourceGroup'

@description('The environment: a key of environments.json.')
@allowed(['dev'])
param environmentName string

@description('The image tag to run: the git SHA that was built and pushed.')
param imageTag string

var config = loadJsonContent('config/environments.json')
var env = config.environments[environmentName]

resource cae 'Microsoft.App/managedEnvironments@2026-07-01' existing = {
  name: 'cae-atlas-${environmentName}'
}

resource migratorIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = {
  name: 'id-atlas-migrator-${environmentName}'
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

resource job 'Microsoft.App/jobs@2026-07-01' = {
  name: 'caj-atlas-migrate-${environmentName}'
  location: env.location
  tags: union(config.tags, { env: environmentName })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${migratorIdentity.id}': {} }
  }
  properties: {
    environmentId: cae.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      replicaTimeout: 600
      replicaRetryLimit: 0
      registries: [{ server: registry.properties.loginServer, identity: migratorIdentity.id }]
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: '${registry.properties.loginServer}/atlas-api:${imageTag}'
          command: ['node', 'apps/api/dist/migrate.js']
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: [
            { name: 'ATLAS_ENV', value: environmentName }
            { name: 'LOG_LEVEL', value: 'info' }
            { name: 'DB_AUTH', value: 'entra' }
            { name: 'PGHOST', value: postgres.properties.fullyQualifiedDomainName }
            { name: 'PGDATABASE', value: 'atlas' }
            // An Entra identity signs in to Postgres under its own name.
            { name: 'PGUSER', value: migratorIdentity.name }
            { name: 'AZURE_CLIENT_ID', value: migratorIdentity.properties.clientId }
            { name: 'API_ROLE_NAME', value: apiIdentity.name }
            { name: 'API_PRINCIPAL_ID', value: apiIdentity.properties.principalId }
          ]
        }
      ]
    }
  }
}
