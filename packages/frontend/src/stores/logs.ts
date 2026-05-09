import { defineStore } from 'pinia'
import { ref } from 'vue'
import client from '@/api/client'

export interface RequestLog {
  id: number
  userId: number | null
  channelId: number | null
  virtualModel: string
  actualModel: string | null
  requestedAt: string
  completedAt: string | null
  duration: number | null
  promptTokens: number | null
  completionTokens: number | null
  statusCode: number | null
  isStreaming: boolean
  errorMessage: string | null
  modelTypes: string   // JSON string: string[]
  user?: { email: string }
  channel?: { name: string }
}

export interface ConversationLog extends RequestLog {
  requestBody: string
  responseBody: string | null
}

export interface LogUser {
  id: number
  email: string
  _count: { requestLogs: number }
}

export interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export const useLogsStore = defineStore('logs', () => {
  const logs = ref<RequestLog[]>([])
  const logsPagination = ref<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 })

  const conversation = ref<ConversationLog[]>([])
  const conversationPagination = ref<Pagination>({ page: 1, limit: 30, total: 0, totalPages: 0 })

  const logUsers = ref<LogUser[]>([])

  async function fetchLogs(params: {
    page?: number
    limit?: number
    userId?: number
    virtualModel?: string
    startDate?: string
    endDate?: string
  } = {}) {
    const res = await client.get('/logs', { params })
    logs.value = res.data.data
    logsPagination.value = res.data.pagination
  }

  async function fetchLogUsers() {
    const res = await client.get('/logs/users')
    logUsers.value = res.data
  }

  async function fetchConversation(userId: number, params: {
    page?: number
    virtualModel?: string
    channelName?: string
    actualModel?: string
    startDate?: string
    endDate?: string
    append?: boolean
  } = {}) {
    const { append, ...queryParams } = params
    const res = await client.get(`/logs/conversation/${userId}`, { params: queryParams })
    if (append) {
      conversation.value = [...conversation.value, ...res.data.data]
    } else {
      conversation.value = res.data.data
    }
    conversationPagination.value = res.data.pagination
  }

  async function clearLogs(userId?: number) {
    await client.delete('/logs', { params: userId ? { userId } : {} })
  }

  return {
    logs, logsPagination,
    conversation, conversationPagination,
    logUsers,
    fetchLogs, fetchLogUsers, fetchConversation, clearLogs,
  }
})
