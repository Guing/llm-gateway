import { defineStore } from 'pinia'
import { ref } from 'vue'
import client from '@/api/client'

export interface ChannelModelRoute {
  id: number
  virtualModel: string
  actualModel: string
  priority: number
  weight: number
  enabled: boolean
  types?: string[]
}

export interface Channel {
  id: number
  name: string
  baseUrl: string
  provider: string
  enabled: boolean
  createdAt: string
  models: string       // JSON string: string[]
  modelAliases: string // JSON string: {[k:string]:string}
  modelTypes?: string  // JSON string: {[k:string]:string[]}
  apiKey?: string
  _count?: { modelRoutes: number }
  modelRoutes?: ChannelModelRoute[]
}

export interface ModelRoute {
  id: number
  virtualModel: string
  actualModel: string
  channelId: number
  priority: number
  weight: number
  enabled: boolean
  createdAt: string
  channel?: { id: number; name: string; provider: string }
}

export interface AdminUser {
  id: number
  email: string
  role: string
  enabled: boolean
  createdAt: string
  _count?: { apiKeys: number; requestLogs: number }
}

export const useAdminStore = defineStore('admin', () => {
  const channels = ref<Channel[]>([])
  const modelRoutes = ref<ModelRoute[]>([])
  const users = ref<AdminUser[]>([])
  const stats = ref({ totalRequests: 0, totalUsers: 0, activeChannels: 0, recentErrors: 0 })

  async function fetchChannels() {
    const res = await client.get('/admin/channels')
    channels.value = res.data
  }

  async function createChannel(data: { name: string; baseUrl: string; apiKey: string; provider: string; models?: string[]; modelAliases?: Record<string, string>; modelTypes?: Record<string, string[]> }) {
    await client.post('/admin/channels', data)
    await fetchChannels()
  }

  async function updateChannel(id: number, data: Partial<Channel & { apiKey: string; models: string[]; modelAliases: Record<string, string>; modelTypes: Record<string, string[]> }>) {
    await client.put(`/admin/channels/${id}`, data)
    await fetchChannels()
  }

  async function deleteChannel(id: number) {
    await client.delete(`/admin/channels/${id}`)
    await fetchChannels()
  }

  async function fetchModelRoutes() {
    const res = await client.get('/admin/routes')
    modelRoutes.value = res.data
  }

  async function createModelRoute(data: { virtualModel: string; actualModel: string; channelId: number; priority: number; weight: number }) {
    await client.post('/admin/routes', data)
    await fetchModelRoutes()
  }

  async function updateModelRoute(id: number, data: Partial<ModelRoute>) {
    await client.put(`/admin/routes/${id}`, data)
    await fetchModelRoutes()
  }

  async function deleteModelRoute(id: number) {
    await client.delete(`/admin/routes/${id}`)
    await fetchModelRoutes()
  }

  async function fetchUsers() {
    const res = await client.get('/admin/users')
    users.value = res.data
  }

  async function createUser(data: { email: string; password: string; role: string }) {
    await client.post('/admin/users', data)
    await fetchUsers()
  }

  async function updateUser(id: number, data: Partial<AdminUser & { password: string }>) {
    await client.patch(`/admin/users/${id}`, data)
    await fetchUsers()
  }

  async function deleteUser(id: number) {
    await client.delete(`/admin/users/${id}`)
    await fetchUsers()
  }

  async function fetchStats() {
    const res = await client.get('/logs/stats')
    stats.value = res.data
  }

  return {
    channels, modelRoutes, users, stats,
    fetchChannels, createChannel, updateChannel, deleteChannel,
    fetchModelRoutes, createModelRoute, updateModelRoute, deleteModelRoute,
    fetchUsers, createUser, updateUser, deleteUser,
    fetchStats,
  }
})
