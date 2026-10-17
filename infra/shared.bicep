// What every environment shares, in rg-atlas-shared (ADR 0017):
//   - the container registry: the image tested in dev is byte for byte the one promoted (ADR 0002)
//   - the one Container Apps environment this subscription allows, with its network and logs.
//     Each stage runs its own apps and job in it; UAT and prod Postgres sit in its private subnets.
targetScope = 'resourceGroup'

var config = loadJsonContent('config/environments.json')
var location = config.shared.location
var tags = union(config.tags, { env: 'shared' })

resource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' = {
  // Registry names are global, so they get a suffix that's stable per subscription.
  name: 'cratlas${uniqueString(subscription().id)}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: {
    // Pushes and pulls use Entra identities (AcrPush, AcrPull); there's no registry password.
    adminUserEnabled: false
  }
}

// ---- Network (spec §7, ADR 0008) ----

resource caeNsg 'Microsoft.Network/networkSecurityGroups@2025-07-01' = {
  name: 'nsg-atlas-shared-cae'
  location: location
  tags: tags
}

resource psqlNsg 'Microsoft.Network/networkSecurityGroups@2025-07-01' = {
  name: 'nsg-atlas-shared-psql'
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
          sourceAddressPrefix: config.shared.network.caeSubnet
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '5432'
        }
      }
    ]
  }
}

// One delegated subnet per environment whose Postgres is private (UAT and prod).
var privateEnvironments = filter(items(config.environments), e => !e.value.postgres.publicAccess)
var postgresSubnets = [
  for e in privateEnvironments: {
    name: 'snet-psql-${e.key}'
    properties: {
      addressPrefix: e.value.postgres.subnet
      networkSecurityGroup: { id: psqlNsg.id }
      delegations: [
        { name: 'postgres', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }
      ]
    }
  }
]

resource vnet 'Microsoft.Network/virtualNetworks@2025-07-01' = {
  name: 'vnet-atlas-shared'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: [config.shared.network.addressSpace] }
    subnets: concat(
      [
        {
          name: 'snet-cae'
          properties: {
            addressPrefix: config.shared.network.caeSubnet
            networkSecurityGroup: { id: caeNsg.id }
            delegations: [
              { name: 'container-apps', properties: { serviceName: 'Microsoft.App/environments' } }
            ]
          }
        }
      ],
      postgresSubnets
    )
  }
}

// ---- Logs ----

resource logs 'Microsoft.OperationalInsights/workspaces@2026-03-01' = {
  name: 'log-atlas-shared'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: config.shared.logRetentionDays
  }
}

// ---- The Container Apps environment: VNet-integrated, external so web apps can be public ----

resource cae 'Microsoft.App/managedEnvironments@2026-07-01' = {
  name: 'cae-atlas'
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

output name string = registry.name
output loginServer string = registry.properties.loginServer
