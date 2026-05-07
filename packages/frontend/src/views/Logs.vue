<template>
  <div class="flex h-full" style="height: calc(100vh - 0px)">
    <!-- Left sidebar: user list -->
    <div class="w-64 border-r border-gray-200 flex flex-col bg-white">
      <div class="p-4 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h3 class="font-semibold text-gray-700">请求日志</h3>
          <p class="text-xs text-gray-400 mt-0.5">选择用户查看对话</p>
        </div>
        <el-tooltip v-if="isAdmin" content="清除全部日志" placement="right">
          <el-button
            size="small"
            type="danger"
            plain
            :loading="clearingAll"
            @click="handleClearAll"
          ><el-icon><Delete /></el-icon></el-button>
        </el-tooltip>
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
                {{ (u.email?.[0] ?? '?').toUpperCase() }}
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
            @click="authStore.user && selectUser(authStore.user.id)"
          >
            <div class="flex items-center gap-2">
              <div class="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-sm font-semibold flex-shrink-0">
                {{ (authStore.user?.email?.[0] ?? '?').toUpperCase() }}
              </div>
              <div class="min-w-0">
                <p class="text-sm font-medium text-gray-800 truncate">{{ authStore.user?.email ?? '' }}</p>
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
          <el-dropdown
            v-if="logsStore.conversation.length > 0"
            @command="handleExport"
          >
            <el-button size="small">
              <el-icon class="mr-1"><Download /></el-icon>导出<el-icon class="ml-1 el-icon--right"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="csv">导出 CSV</el-dropdown-item>
                <el-dropdown-item command="txt">导出 TXT</el-dropdown-item>
                <el-dropdown-item command="md">导出 Markdown</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button
            v-if="isAdmin && selectedUserId"
            size="small"
            type="danger"
            plain
            :loading="clearingUser"
            @click="handleClearUser"
          ><el-icon class="mr-1"><Delete /></el-icon>清除日志</el-button>
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
          <!-- Scroll sentinel: visible when scrolled to top → triggers load older -->
          <div ref="scrollSentinel" class="h-px"></div>

          <!-- Loading more indicator -->
          <div v-if="isLoadingMore" class="text-center py-2">
            <el-icon class="animate-spin"><Loading /></el-icon>
            <span class="text-xs text-gray-400 ml-1">加载历史消息...</span>
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
              <el-tag v-if="log.actualModel" size="small" type="info" class="!text-xs">→ {{ log.actualModel }}</el-tag>
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
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { Download, ArrowDown, Delete } from '@element-plus/icons-vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { useLogsStore } from '@/stores/logs'
import { useAuthStore } from '@/stores/auth'

const logsStore = useLogsStore()
const authStore = useAuthStore()

const isAdmin = computed(() => authStore.isAdmin)
const selectedUserId = ref<number | null>(null)
const loadingConversation = ref(false)
const isLoadingMore = ref(false)
const filterModel = ref('')
const dateRange = ref<string[]>([])
const chatContainer = ref<HTMLElement>()
const scrollSentinel = ref<HTMLElement | null>(null)
let scrollObserver: IntersectionObserver | null = null

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
    // Setup sentinel observer after initial render
    await nextTick()
    setupScrollObserver()
  } finally {
    loadingConversation.value = false
  }
}

function setupScrollObserver() {
  scrollObserver?.disconnect()
  if (!scrollSentinel.value || !chatContainer.value) return
  scrollObserver = new IntersectionObserver(
    async (entries) => {
      if (
        entries[0].isIntersecting &&
        !isLoadingMore.value &&
        !loadingConversation.value &&
        logsStore.conversationPagination.page < logsStore.conversationPagination.totalPages
      ) {
        await loadMore()
      }
    },
    { root: chatContainer.value, threshold: 0 },
  )
  scrollObserver.observe(scrollSentinel.value)
}

async function reloadConversation() {
  if (selectedUserId.value) await loadConversation(selectedUserId.value, 1)
}

async function applyFilter() {
  if (isAdmin.value) await logsStore.fetchLogUsers()
  if (selectedUserId.value) await reloadConversation()
}

async function loadMore() {
  if (!selectedUserId.value || isLoadingMore.value) return
  isLoadingMore.value = true
  const container = chatContainer.value
  const prevScrollHeight = container?.scrollHeight ?? 0
  try {
    await logsStore.fetchConversation(selectedUserId.value, {
      page: logsStore.conversationPagination.page + 1,
      virtualModel: filterModel.value || undefined,
      append: true,
    })
    await nextTick()
    // Maintain scroll position: offset by newly prepended content height
    if (container) {
      container.scrollTop = container.scrollHeight - prevScrollHeight
    }
  } finally {
    isLoadingMore.value = false
  }
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function baseFilename() {
  return `logs-${selectedUserEmail.value ?? 'unknown'}-${new Date().toISOString().slice(0, 10)}`
}

function handleExport(format: string) {
  if (format === 'csv') exportCSV()
  else if (format === 'txt') exportTXT()
  else if (format === 'md') exportMD()
}

function exportCSV() {
  const headers = ['时间', '虚拟模型', '实际模型', '渠道', '用户消息', '助手回复', '错误信息', '流式', '输入tokens', '输出tokens', '耗时ms']
  const rows = logsStore.conversation.map((log) => {
    const userMsgs = parseMessages(log.requestBody)
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join(' | ')
    return [
      formatTime(log.requestedAt),
      log.virtualModel,
      log.actualModel ?? '',
      log.channel?.name ?? '',
      userMsgs,
      parseAssistantContent(log.responseBody),
      log.errorMessage ?? '',
      log.isStreaming ? '是' : '否',
      log.promptTokens ?? '',
      log.completionTokens ?? '',
      log.duration ?? '',
    ]
  })
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  downloadBlob('\ufeff' + csv, `${baseFilename()}.csv`, 'text/csv;charset=utf-8')
}

function exportTXT() {
  const sep = '─'.repeat(60)
  const lines: string[] = []
  lines.push(`请求日志 — ${selectedUserEmail.value}`)
  lines.push(`导出时间：${new Date().toLocaleString('zh-CN')}`)
  lines.push(`共 ${logsStore.conversation.length} 条记录`)
  lines.push('')
  for (const log of logsStore.conversation) {
    lines.push(sep)
    lines.push(`[${formatTime(log.requestedAt)}]  模型: ${log.virtualModel}${log.actualModel ? ' → ' + log.actualModel : ''}${log.channel?.name ? '  渠道: ' + log.channel.name : ''}${log.duration != null ? '  耗时: ' + log.duration + 'ms' : ''}${log.isStreaming ? '  [SSE]' : ''}`)
    if (log.promptTokens || log.completionTokens) {
      lines.push(`  Tokens: 输入 ${log.promptTokens ?? 0}  输出 ${log.completionTokens ?? 0}`)
    }
    for (const msg of parseMessages(log.requestBody)) {
      if (msg.role === 'user') {
        lines.push('')
        lines.push('  [用户]')
        lines.push(msg.content.split('\n').map((l) => '    ' + l).join('\n'))
      } else if (msg.role === 'system') {
        lines.push('')
        lines.push('  [System]')
        lines.push(msg.content.split('\n').map((l) => '    ' + l).join('\n'))
      }
    }
    const assistantContent = parseAssistantContent(log.responseBody)
    if (assistantContent || log.errorMessage) {
      lines.push('')
      lines.push('  [助手]')
      lines.push((log.errorMessage ? '[错误] ' + log.errorMessage : assistantContent).split('\n').map((l) => '    ' + l).join('\n'))
    }
    lines.push('')
  }
  downloadBlob(lines.join('\n'), `${baseFilename()}.txt`, 'text/plain;charset=utf-8')
}

function exportMD() {
  const lines: string[] = []
  lines.push(`# 请求日志 — ${selectedUserEmail.value}`)
  lines.push('')
  lines.push(`> 导出时间：${new Date().toLocaleString('zh-CN')}  共 ${logsStore.conversation.length} 条记录`)
  lines.push('')
  for (const log of logsStore.conversation) {
    const meta: string[] = [
      `**${formatTime(log.requestedAt)}**`,
      `模型: \`${log.virtualModel}\``,
    ]
    if (log.actualModel) meta.push(`→ \`${log.actualModel}\``)
    if (log.channel?.name) meta.push(`渠道: ${log.channel.name}`)
    if (log.duration != null) meta.push(`${log.duration}ms`)
    if (log.isStreaming) meta.push('`SSE`')
    if (log.promptTokens || log.completionTokens) {
      meta.push(`tokens: ${log.promptTokens ?? 0}↑ ${log.completionTokens ?? 0}↓`)
    }
    lines.push('---')
    lines.push('')
    lines.push(meta.join(' · '))
    lines.push('')
    for (const msg of parseMessages(log.requestBody)) {
      if (msg.role === 'user') {
        lines.push('**🧑 用户**')
        lines.push('')
        lines.push(msg.content.split('\n').map((l) => '> ' + l).join('\n'))
        lines.push('')
      } else if (msg.role === 'system') {
        lines.push('**⚙️ System**')
        lines.push('')
        lines.push('```')
        lines.push(msg.content)
        lines.push('```')
        lines.push('')
      }
    }
    const assistantContent = parseAssistantContent(log.responseBody)
    if (assistantContent || log.errorMessage) {
      if (log.errorMessage) {
        lines.push('**❌ 错误**')
        lines.push('')
        lines.push('```')
        lines.push(log.errorMessage)
        lines.push('```')
      } else {
        lines.push('**🤖 助手**')
        lines.push('')
        lines.push(assistantContent)
      }
      lines.push('')
    }
  }
  downloadBlob(lines.join('\n'), `${baseFilename()}.md`, 'text/markdown;charset=utf-8')
}

const clearingAll = ref(false)
const clearingUser = ref(false)

async function handleClearAll() {
  try {
    await ElMessageBox.confirm(
      '确认要清除全部用户的所有请求日志？此操作不可恢复。',
      '清除全部日志',
      { type: 'warning', confirmButtonText: '确认清除', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' }
    )
  } catch {
    return
  }
  clearingAll.value = true
  try {
    await logsStore.clearLogs()
    ElMessage.success('已清除全部日志')
    await logsStore.fetchLogUsers()
    selectedUserId.value = null
    logsStore.conversation.splice(0)
  } catch {
    ElMessage.error('清除失败')
  } finally {
    clearingAll.value = false
  }
}

async function handleClearUser() {
  if (!selectedUserId.value) return
  const email = selectedUserEmail.value
  try {
    await ElMessageBox.confirm(
      `确认要清除「${email}」的所有日志？此操作不可恢复。`,
      '清除用户日志',
      { type: 'warning', confirmButtonText: '确认清除', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' }
    )
  } catch {
    return
  }
  clearingUser.value = true
  try {
    await logsStore.clearLogs(selectedUserId.value)
    ElMessage.success(`已清除「${email}」的日志`)
    await logsStore.fetchLogUsers()
    selectedUserId.value = null
    logsStore.conversation.splice(0)
  } catch {
    ElMessage.error('清除失败')
  } finally {
    clearingUser.value = false
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

onBeforeUnmount(() => {
  scrollObserver?.disconnect()
})
</script>
