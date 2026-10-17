// The shared container registry, in rg-atlas-shared. Every environment pulls the same image from
// it, so the image tested in dev is byte for byte the one promoted later (ADR 0002).
targetScope = 'resourceGroup'

var config = loadJsonContent('config/environments.json')

resource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' = {
  // Registry names are global, so they get a suffix that's stable per subscription.
  name: 'cratlas${uniqueString(subscription().id)}'
  location: config.shared.location
  tags: union(config.tags, { env: 'shared' })
  sku: { name: 'Basic' }
  properties: {
    // Pushes and pulls use Entra identities (AcrPush, AcrPull); there's no registry password.
    adminUserEnabled: false
  }
}

output name string = registry.name
output loginServer string = registry.properties.loginServer
