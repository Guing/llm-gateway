<template>
  <div class="flex h-full" style="height: calc(100vh - 0px)">
    <!-- Left sidebar: user list -->
    <div class="w-64 border-r border-gray-200 flex flex-col bg-white">
      <div class="p-4 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h3 class="font-semibold text-gray-700">请求日志</h3>
          <p class="text-xs text-gray-400 mt-0.5">选择用户查看对话</p>
        </div>
        <div class="flex items-center gap-1">
          <el-tooltip content="刷新" placement="right">
            <el-button size="small" :loading="refreshing" @click="handleRefresh">
              <el-icon><RefreshRight /></el-icon>
            </el-button>
          </el-tooltip>
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
      <div v-if="selectedUserId" class="px-6 pt-3 pb-2 bg-white border-b border-gray-200">
        <!-- Row 1: user info + action buttons -->
        <div class="flex items-center justify-between mb-2">
          <div>
            <h4 class="font-semibold text-gray-700">{{ selectedUserEmail }}</h4>
            <p class="text-xs text-gray-400">
              共 {{ logsStore.conversationPagination.total }} 条对话记录
            </p>
          </div>
          <div class="flex items-center gap-2">
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
                  <el-dropdown-item divided command="toggle-system-filter">
                    <span class="flex items-center gap-1">
                      <el-icon v-if="exportFilterSystem" class="text-blue-500"><Check /></el-icon>
                      <span v-else class="inline-block w-4"></span>
                      过滤系统提示词
                    </span>
                  </el-dropdown-item>
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
        <!-- Row 2: filters -->
        <div class="flex items-center gap-2 flex-wrap">
          <el-select
            v-model="filterModel"
            placeholder="筛选模型"
            size="small"
            clearable
            style="width: 150px"
            @change="reloadConversation"
          >
            <el-option
              v-for="m in availableModels"
              :key="m"
              :label="m"
              :value="m"
            />
          </el-select>
          <el-select
            v-model="filterChannel"
            placeholder="筛选渠道"
            size="small"
            clearable
            style="width: 140px"
            @change="reloadConversation"
          >
            <el-option
              v-for="c in availableChannels"
              :key="c"
              :label="c"
              :value="c"
            />
          </el-select>
          <el-select
            v-model="filterActualModel"
            placeholder="筛选原模型"
            size="small"
            clearable
            style="width: 150px"
            @change="reloadConversation"
          >
            <el-option
              v-for="m in availableActualModels"
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
          <!-- Scroll sentinel: visible when scrolled to top → triggers load older -->
          <div ref="scrollSentinel" class="h-px"></div>

          <!-- Loading more indicator -->
          <div v-if="isLoadingMore" class="text-center py-2">
            <el-icon class="animate-spin"><Loading /></el-icon>
            <span class="text-xs text-gray-400 ml-1">加载历史消息...</span>
          </div>

          <div
            v-for="log in displayedConversation"
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
              <!-- User message: right aligned, shows text + images -->
              <div v-if="msg.role === 'user' && (msg.content || msg.images.length)" class="flex justify-end">
                <div class="max-w-[70%]">
                  <div class="bg-blue-500 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm shadow-sm">
                    <div v-if="msg.images.length" class="flex flex-wrap gap-1 mb-1.5">
                      <el-image
                        v-for="(imgUrl, iIdx) in msg.images"
                        :key="iIdx"
                        :src="imgUrl"
                        :preview-src-list="msg.images"
                        :initial-index="iIdx"
                        fit="contain"
                        class="max-w-[180px] max-h-[180px] rounded overflow-hidden bg-white/10"
                      />
                    </div>
                    <p v-if="msg.content" class="whitespace-pre-wrap break-words">{{ msg.content }}</p>
                  </div>
                </div>
              </div>

              <!-- System message: centered, collapsed by default -->
              <div v-else-if="msg.role === 'system' && msg.content" class="flex justify-center">
                <div
                  class="max-w-[80%] bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg px-3 py-1.5 text-xs cursor-pointer select-none"
                  @click="toggleSystem(log.id, idx)"
                >
                  <span class="font-semibold mr-1">[System]</span>
                  <span v-if="isSystemExpanded(log.id, idx)" class="whitespace-pre-wrap break-words">{{ msg.content }}</span>
                  <span v-else class="text-yellow-500 italic">{{ msg.content.slice(0, 40) }}{{ msg.content.length > 40 ? '…' : '' }} <span class="underline">点击展开</span></span>
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
const refreshing = ref(false)
const filterModel = ref('')
const filterChannel = ref('')
const filterActualModel = ref('')
const exportFilterSystem = ref(false)
const dateRange = ref<string[]>([])
const chatContainer = ref<HTMLElement>()
const scrollSentinel = ref<HTMLElement | null>(null)
let scrollObserver: IntersectionObserver | null = null

// System message expand/collapse state, key = `${logId}-${msgIdx}`
const expandedSystems = ref<Set<string>>(new Set())
function systemKey(logId: number, idx: number) { return `${logId}-${idx}` }
function isSystemExpanded(logId: number, idx: number) { return expandedSystems.value.has(systemKey(logId, idx)) }
function toggleSystem(logId: number, idx: number) {
  const key = systemKey(logId, idx)
  if (expandedSystems.value.has(key)) expandedSystems.value.delete(key)
  else expandedSystems.value.add(key)
}

const selectedUserEmail = computed(() => {
  if (!isAdmin.value) return authStore.user?.email
  return logsStore.logUsers.find((u) => u.id === selectedUserId.value)?.email ?? ''
})

const availableModels = computed(() => {
  const models = new Set(logsStore.conversation.map((l) => l.virtualModel))
  return [...models]
})

const availableChannels = computed(() => {
  const set = new Set(logsStore.conversation.map((l) => l.channel?.name).filter(Boolean) as string[])
  return [...set]
})

const availableActualModels = computed(() => {
  const set = new Set(logsStore.conversation.map((l) => l.actualModel).filter(Boolean) as string[])
  return [...set]
})

const displayedConversation = computed(() => [...logsStore.conversation].reverse())

function formatTime(t: string) {
  return new Date(t).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface ParsedMessage {
  role: string
  content: string
  images: string[]
}

function parseMessages(requestBody: string): ParsedMessage[] {
  try {
    const body = JSON.parse(requestBody)
    // OpenAI format
    const rawMsgs: Array<{ role: string; content: unknown }> = body.messages ?? []
    // Prepend system from Anthropic-style top-level system field
    if (body.system && !rawMsgs.find((m) => m.role === 'system')) {
      rawMsgs.unshift({ role: 'system', content: body.system })
    }
    return rawMsgs.map((m) => ({
      role: m.role,
      content: extractTextContent(m.content),
      images: extractImages(m.content),
    }))
  } catch {
    return []
  }
}

/** Handles content as string, null, or OpenAI content-block array */
function extractTextContent(content: unknown): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text!)
      .join('\n')
  }
  return String(content)
}

/** Extract image URLs from content blocks (OpenAI image_url / Anthropic image source) */
function extractImages(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  const urls: string[] = []
  for (const c of content as Array<{
    type?: string
    image_url?: { url?: string }
    source?: { type?: string; media_type?: string; data?: string }
  }>) {
    if (c.type === 'image_url' && c.image_url?.url) {
      urls.push(c.image_url.url)
    } else if (c.type === 'image' && c.source?.data) {
      // Anthropic base64 format
      urls.push(`data:${c.source.media_type ?? 'image/jpeg'};base64,${c.source.data}`)
    }
  }
  return urls
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
      channelName: filterChannel.value || undefined,
      actualModel: filterActualModel.value || undefined,
      startDate: dateRange.value?.[0] || undefined,
      endDate: dateRange.value?.[1] || undefined,
    })
    // Must set false BEFORE nextTick so chat bubbles render before we measure scrollHeight
    loadingConversation.value = false
    await nextTick()
    if (chatContainer.value && page === 1) {
      chatContainer.value.scrollTop = chatContainer.value.scrollHeight
    }
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

async function handleRefresh() {
  refreshing.value = true
  try {
    if (isAdmin.value) await logsStore.fetchLogUsers()
    if (selectedUserId.value) await reloadConversation()
  } finally {
    refreshing.value = false
  }
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
      channelName: filterChannel.value || undefined,
      actualModel: filterActualModel.value || undefined,
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
  if (format === 'toggle-system-filter') {
    exportFilterSystem.value = !exportFilterSystem.value
    return
  }
  if (format === 'csv') exportCSV()
  else if (format === 'txt') exportTXT()
  else if (format === 'md') exportMD()
}

function exportCSV() {
  const data = displayedConversation.value
  const headers = exportFilterSystem.value
    ? ['时间', '虚拟模型', '实际模型', '渠道', '用户消息', '助手回复', '错误信息', '流式', '输入tokens', '输出tokens', '耗时ms']
    : ['时间', '虚拟模型', '实际模型', '渠道', '用户消息', '系统提示词', '助手回复', '错误信息', '流式', '输入tokens', '输出tokens', '耗时ms']
  const rows = data.map((log) => {
    const msgs = parseMessages(log.requestBody)
    const userMsgs = msgs.filter((m) => m.role === 'user').map((m) => m.content).join(' | ')
    const systemMsgs = msgs.filter((m) => m.role === 'system').map((m) => m.content).join(' | ')
    const row = [
      formatTime(log.requestedAt),
      log.virtualModel,
      log.actualModel ?? '',
      log.channel?.name ?? '',
      userMsgs,
    ]
    if (!exportFilterSystem.value) row.push(systemMsgs)
    row.push(
      parseAssistantContent(log.responseBody),
      log.errorMessage ?? '',
      log.isStreaming ? '是' : '否',
      String(log.promptTokens ?? ''),
      String(log.completionTokens ?? ''),
      String(log.duration ?? ''),
    )
    return row
  })
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  downloadBlob('\ufeff' + csv, `${baseFilename()}.csv`, 'text/csv;charset=utf-8')
}

function exportTXT() {
  const data = displayedConversation.value
  const sep = '─'.repeat(60)
  const lines: string[] = []
  lines.push(`请求日志 — ${selectedUserEmail.value}`)
  lines.push(`导出时间：${new Date().toLocaleString('zh-CN')}`)
  lines.push(`共 ${data.length} 条记录`)
  lines.push('')
  for (const log of data) {
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
      } else if (msg.role === 'system' && !exportFilterSystem.value) {
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
  const data = displayedConversation.value
  const lines: string[] = []
  lines.push(`# 请求日志 — ${selectedUserEmail.value}`)
  lines.push('')
  lines.push(`> 导出时间：${new Date().toLocaleString('zh-CN')}  共 ${data.length} 条记录`)
  lines.push('')
  for (const log of data) {
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
      } else if (msg.role === 'system' && !exportFilterSystem.value) {
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
