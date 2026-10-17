// The Postgres Entra admins (spec §6.4): the migrator identity, which owns the schema, and the human
// admin group. A module, because an admin's name is its object id, which Bicep must know when the
// deployment starts; module parameters are.
targetScope = 'resourceGroup'

param serverName string
param migratorPrincipalId string
param migratorName string
param groupObjectId string
param groupName string

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' existing = {
  name: serverName
}

resource migratorAdmin 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2025-08-01' = {
  parent: postgres
  name: migratorPrincipalId
  properties: {
    principalName: migratorName
    principalType: 'ServicePrincipal'
    tenantId: tenant().tenantId
  }
}

// Postgres takes one admin change at a time.
resource groupAdmin 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2025-08-01' = {
  parent: postgres
  name: groupObjectId
  properties: {
    principalName: groupName
    principalType: 'Group'
    tenantId: tenant().tenantId
  }
  dependsOn: [migratorAdmin]
}
