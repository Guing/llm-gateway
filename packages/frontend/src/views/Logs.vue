<template>
  <div class="flex h-full" style="height: calc(100vh - 0px)">
    <!-- Left sidebar: user list -->
    <div class="w-64 border-r border-gray-200 flex flex-col bg-white">
      <div class="p-4 border-b border-gray-200">
        <h3 class="font-semibold text-gray-700">请求日志</h3>
        <p class="text-xs text-gray-400 mt-0.5">选择用户查看对话</p>
      </div>

      <!-- Filters (admin only) -->
      <div v-if="isAdmin" class="px-3 py-3 border-b border-gray-100 space-y-2">
        <el-input
          v-model="filterModel"
          placeholder="过滤模型名"
          size="small"
          clearable
          @change="applyFilter"
        />
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          size="small"
          range-separator="-"
          start-placeholder="开始"
          end-placeholder="结束"
          format="MM/DD"
          value-format="YYYY-MM-DD"
          style="width: 100%"
          @change="applyFilter"
        />
      </div>

      <div class="flex-1 overflow-y-auto">
        <!-- Admin: show all users -->
        <template v-if="isAdmin">
          <div
            v-for="u in logsStore.logUsers"
            :key="u.id"
            :class="[
              'px-4 py-3 cursor-pointer hover:bg-gray-50 border-b border-gray-100 transition-colors',
              selectedUserId === u.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : '',
            ]"
            @click="selectUser(u.id)"
          >
            <div class="flex items-center gap-2">
              <div class="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-sm font-semibold flex-shrink-0">
                {{ u.email[0].toUpperCase() }}
              </div>
              <div class="min-w-0">
                <p class="text-sm font-medium text-gray-800 truncate">{{ u.email }}</p>
                <p class="text-xs text-gray-400">{{ u._count.requestLogs }} 次请求</p>
              </div>
            </div>
          </div>
          <div v-if="logsStore.logUsers.length === 0" class="p-4 text-sm text-gray-400 text-center">
            暂无数据
          </div>
        </template>

        <!-- Non-admin: show self only -->
        <template v-else>
          <div
            :class="[
              'px-4 py-3 cursor-pointer hover:bg-gray-50 border-b border-gray-100',
              'bg-blue-50 border-l-2 border-l-blue-500',
            ]"
            @click="selectUser(authStore.user!.id)"
          >
            <div class="flex items-center gap-2">
              <div class="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-sm font-semibold flex-shrink-0">
                {{ authStore.user!.email[0].toUpperCase() }}
              </div>
              <div class="min-w-0">
                <p class="text-sm font-medium text-gray-800 truncate">{{ authStore.user!.email }}</p>
                <p class="text-xs text-gray-400">我的对话记录</p>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Right: conversation view -->
    <div class="flex-1 flex flex-col bg-gray-50">
      <!-- Header -->
      <div v-if="selectedUserId" class="px-6 py-3 bg-white border-b border-gray-200 flex items-center justify-between">
        <div>
          <h4 class="font-semibold text-gray-700">{{ selectedUserEmail }}</h4>
          <p class="text-xs text-gray-400">
            共 {{ logsStore.conversationPagination.total }} 条对话记录
          </p>
        </div>
        <div class="flex items-center gap-2">
          <el-select
            v-model="filterModel"
            placeholder="筛选模型"
            size="small"
            clearable
            style="width: 160px"
            @change="reloadConversation"
          >
            <el-option
              v-for="m in availableModels"
              :key="m"
              :label="m"
              :value="m"
            />
          </el-select>
        </div>
      </div>

      <!-- Empty state -->
      <div
        v-if="!selectedUserId"
        class="flex-1 flex items-center justify-center text-gray-400"
      >
        <div class="text-center">
          <el-icon size="48" class="mb-2"><ChatDotRound /></el-icon>
          <p>选择左侧用户查看对话记录</p>
        </div>
      </div>

      <!-- Chat bubbles -->
      <div
        v-else
        ref="chatContainer"
        class="flex-1 overflow-y-auto px-6 py-4 space-y-6"
      >
        <div v-if="loadingConversation" class="text-center py-8">
          <el-icon class="animate-spin"><Loading /></el-icon>
          <p class="text-sm text-gray-400 mt-2">加载中...</p>
        </div>

        <template v-else>
          <!-- Load more -->
          <div v-if="logsStore.conversationPagination.page < logsStore.conversationPagination.totalPages" class="text-center">
            <el-button size="small" @click="loadMore">加载更多</el-button>
          </div>

          <div
            v-for="log in logsStore.conversation"
            :key="log.id"
            class="space-y-2"
          >
            <!-- Meta info -->
            <div class="flex items-center gap-2 text-xs text-gray-400">
              <span>{{ formatTime(log.requestedAt) }}</span>
              <el-tag size="small" type="info" class="!text-xs">{{ log.virtualModel }}</el-tag>
              <el-tag v-if="log.actualModel" size="small" type="" class="!text-xs">→ {{ log.actualModel }}</el-tag>
              <el-tag v-if="log.channel?.name" size="small" type="success" class="!text-xs">{{ log.channel.name }}</el-tag>
              <span v-if="log.duration != null" class="text-gray-300">{{ log.duration }}ms</span>
              <el-tag v-if="log.isStreaming" size="small" type="warning" class="!text-xs">SSE</el-tag>
              <el-tag v-if="log.errorMessage" size="small" type="danger" class="!text-xs">Error</el-tag>
            </div>

            <!-- User messages (from requestBody) -->
            <template v-for="(msg, idx) in parseMessages(log.requestBody)" :key="idx">
              <!-- User message: right aligned -->
              <div v-if="msg.role === 'user'" class="flex justify-end">
                <div class="max-w-[70%]">
                  <div class="bg-blue-500 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm shadow-sm">
                    <p class="whitespace-pre-wrap break-words">{{ msg.content }}</p>
                  </div>
                </div>
              </div>

              <!-- System message: centered -->
              <div v-else-if="msg.role === 'system'" class="flex justify-center">
                <div class="max-w-[80%] bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg px-3 py-1.5 text-xs">
                  <span class="font-semibold mr-1">[System]</span>{{ msg.content }}
                </div>
              </div>
            </template>

            <!-- Assistant response: left aligned -->
            <div v-if="parseAssistantContent(log.responseBody)" class="flex justify-start">
              <div class="max-w-[70%]">
                <div
                  :class="[
                    'rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm shadow-sm',
                    log.errorMessage
                      ? 'bg-red-50 border border-red-200 text-red-700'
                      : 'bg-white text-gray-800 border border-gray-200',
                  ]"
                >
                  <p class="whitespace-pre-wrap break-words">
                    {{ log.errorMessage || parseAssistantContent(log.responseBody) }}
                  </p>
                  <!-- Token usage -->
                  <div v-if="log.promptTokens || log.completionTokens" class="mt-1.5 pt-1.5 border-t border-gray-100 flex gap-3 text-xs text-gray-400">
                    <span v-if="log.promptTokens">输入 {{ log.promptTokens }} tokens</span>
                    <span v-if="log.completionTokens">输出 {{ log.completionTokens }} tokens</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="logsStore.conversation.length === 0" class="text-center py-12 text-gray-400">
            <el-icon size="40"><ChatLineRound /></el-icon>
            <p class="mt-2">该用户暂无对话记录</p>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useLogsStore } from '@/stores/logs'
import { useAuthStore } from '@/stores/auth'

const logsStore = useLogsStore()
const authStore = useAuthStore()

const isAdmin = computed(() => authStore.isAdmin)
const selectedUserId = ref<number | null>(null)
const loadingConversation = ref(false)
const filterModel = ref('')
const dateRange = ref<string[]>([])
const chatContainer = ref<HTMLElement>()

const selectedUserEmail = computed(() => {
  if (!isAdmin.value) return authStore.user?.email
  return logsStore.logUsers.find((u) => u.id === selectedUserId.value)?.email ?? ''
})

const availableModels = computed(() => {
  const models = new Set(logsStore.conversation.map((l) => l.virtualModel))
  return [...models]
})

function formatTime(t: string) {
  return new Date(t).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function parseMessages(requestBody: string): Array<{ role: string; content: string }> {
  try {
    const body = JSON.parse(requestBody)
    // OpenAI format
    if (body.messages) return body.messages
    // Anthropic format
    const msgs: Array<{ role: string; content: string }> = []
    if (body.system) msgs.push({ role: 'system', content: body.system })
    if (body.messages) msgs.push(...body.messages)
    return msgs
  } catch {
    return []
  }
}

function parseAssistantContent(responseBody: string | null): string {
  if (!responseBody) return ''
  try {
    const body = JSON.parse(responseBody)
    // OpenAI format
    if (body.choices?.[0]?.message?.content) return body.choices[0].message.content
    // Anthropic format
    if (body.content?.[0]?.text) return body.content[0].text
    return ''
  } catch {
    return ''
  }
}

async function selectUser(userId: number) {
  selectedUserId.value = userId
  await loadConversation(userId, 1)
}

async function loadConversation(userId: number, page = 1) {
  loadingConversation.value = true
  try {
    await logsStore.fetchConversation(userId, {
      page,
      virtualModel: filterModel.value || undefined,
      startDate: dateRange.value?.[0] || undefined,
      endDate: dateRange.value?.[1] || undefined,
    })
    await nextTick()
    if (chatContainer.value && page === 1) {
      chatContainer.value.scrollTop = chatContainer.value.scrollHeight
    }
  } finally {
    loadingConversation.value = false
  }
}

async function reloadConversation() {
  if (selectedUserId.value) await loadConversation(selectedUserId.value, 1)
}

async function applyFilter() {
  if (isAdmin.value) await logsStore.fetchLogUsers()
  if (selectedUserId.value) await reloadConversation()
}

async function loadMore() {
  if (!selectedUserId.value) return
  const nextPage = logsStore.conversationPagination.page + 1
  loadingConversation.value = true
  try {
    const res = await logsStore.fetchConversation(selectedUserId.value, {
      page: nextPage,
      virtualModel: filterModel.value || undefined,
    })
    return res
  } finally {
    loadingConversation.value = false
  }
}

onMounted(async () => {
  if (isAdmin.value) {
    await logsStore.fetchLogUsers()
  } else {
    // Non-admin: auto select self
    const selfId = authStore.user!.id
    selectedUserId.value = selfId
    await loadConversation(selfId)
  }
})
</script>
