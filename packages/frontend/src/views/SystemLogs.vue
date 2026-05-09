<template>
  <div class="flex flex-col h-full bg-gray-950 text-gray-200 font-mono text-xs">
    <!-- Toolbar -->
    <div class="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-gray-900 border-b border-gray-700 shrink-0">
      <!-- Date selector -->
      <el-select
        v-model="selectedDate"
        placeholder="选择日期"
        size="small"
        style="width: 140px"
        @change="loadLogs"
      >
        <el-option
          v-for="d in availableDates"
          :key="d"
          :label="d"
          :value="d"
        />
      </el-select>

      <!-- Level filter -->
      <el-select
        v-model="selectedLevel"
        placeholder="级别"
        size="small"
        style="width: 100px"
        @change="loadLogs"
      >
        <el-option label="全部" value="ALL" />
        <el-option label="INFO" value="INFO" />
        <el-option label="WARN" value="WARN" />
        <el-option label="ERROR" value="ERROR" />
        <el-option label="DEBUG" value="DEBUG" />
      </el-select>

      <!-- Keyword search -->
      <el-input
        v-model="keyword"
        placeholder="关键词过滤"
        size="small"
        clearable
        style="width: 200px"
        @change="loadLogs"
        @clear="loadLogs"
      />

      <!-- Tail lines -->
      <el-select
        v-model="tailLines"
        size="small"
        style="width: 110px"
        @change="loadLogs"
      >
        <el-option label="最近 200 行" :value="200" />
        <el-option label="最近 500 行" :value="500" />
        <el-option label="最近 1000 行" :value="1000" />
        <el-option label="最近 2000 行" :value="2000" />
      </el-select>

      <div class="flex-1" />

      <!-- Stats -->
      <span class="text-gray-500 text-xs">共 {{ totalLines }} 行</span>

      <!-- Auto-refresh toggle -->
      <el-tooltip :content="liveMode ? '关闭实时刷新' : '开启实时刷新'" placement="bottom">
        <el-button
          :type="liveMode ? 'success' : 'default'"
          size="small"
          :loading="connecting"
          @click="toggleLive"
        >
          <el-icon class="mr-1"><VideoPlay v-if="!liveMode" /><VideoPause v-else /></el-icon>
          {{ liveMode ? '实时' : '静态' }}
        </el-button>
      </el-tooltip>

      <!-- Manual refresh -->
      <el-tooltip content="刷新" placement="bottom">
        <el-button size="small" :loading="loading" @click="loadLogs">
          <el-icon><RefreshRight /></el-icon>
        </el-button>
      </el-tooltip>

      <!-- Scroll to bottom -->
      <el-tooltip content="滚动到底部" placement="bottom">
        <el-button size="small" @click="scrollToBottom">
          <el-icon><ArrowDown /></el-icon>
        </el-button>
      </el-tooltip>
    </div>

    <!-- Log output -->
    <div
      ref="logContainer"
      class="flex-1 overflow-y-auto px-4 py-3 space-y-0.5"
    >
      <div v-if="loading && lines.length === 0" class="text-gray-500 py-8 text-center">
        <el-icon class="animate-spin mr-1"><Loading /></el-icon> 加载中...
      </div>
      <div v-else-if="lines.length === 0" class="text-gray-500 py-8 text-center">
        暂无日志
      </div>
      <div
        v-for="(line, idx) in lines"
        :key="idx"
        :class="lineClass(line)"
        class="leading-5 whitespace-pre-wrap break-all"
      >{{ line }}</div>

      <!-- Live new-line highlight animation anchor -->
      <div ref="bottomAnchor" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { RefreshRight, ArrowDown, VideoPlay, VideoPause, Loading } from '@element-plus/icons-vue'
import client from '@/api/client'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()

const selectedDate = ref('')
const selectedLevel = ref('ALL')
const keyword = ref('')
const tailLines = ref(500)

const lines = ref<string[]>([])
const totalLines = ref(0)
const loading = ref(false)
const liveMode = ref(false)
const connecting = ref(false)

const availableDates = ref<string[]>([])
const logContainer = ref<HTMLElement>()
const bottomAnchor = ref<HTMLElement>()

let eventSource: EventSource | null = null
// Whether the user is pinned to the bottom (auto-scroll on new lines)
let pinnedToBottom = true

// ── Fetch available dates ─────────────────────────────────────────────────────
async function fetchDates() {
  const res = await client.get('/admin/system-logs/dates')
  availableDates.value = res.data as string[]
  if (!selectedDate.value && availableDates.value.length > 0) {
    selectedDate.value = availableDates.value[0]
  }
}

// ── Load log lines ────────────────────────────────────────────────────────────
async function loadLogs() {
  loading.value = true
  try {
    const res = await client.get('/admin/system-logs', {
      params: {
        date: selectedDate.value,
        level: selectedLevel.value === 'ALL' ? undefined : selectedLevel.value,
        keyword: keyword.value || undefined,
        tail: tailLines.value,
      },
    })
    lines.value = res.data.lines
    totalLines.value = res.data.total
    await nextTick()
    if (pinnedToBottom) scrollToBottom()
  } finally {
    loading.value = false
  }
}

// ── SSE live mode ─────────────────────────────────────────────────────────────
function toggleLive() {
  if (liveMode.value) {
    stopLive()
  } else {
    startLive()
  }
}

function startLive() {
  stopLive()
  connecting.value = true

  // Build SSE URL using the same base URL as axios
  const base = (client.defaults.baseURL ?? '/api').replace(/\/$/, '')
  const url = `${base}/admin/system-logs/stream?date=${encodeURIComponent(selectedDate.value)}`

  // Attach auth token as query param since EventSource doesn't support headers
  const token = authStore.token ?? ''
  const fullUrl = token ? `${url}&token=${encodeURIComponent(token)}` : url

  eventSource = new EventSource(fullUrl)

  eventSource.onopen = () => {
    liveMode.value = true
    connecting.value = false
  }

  eventSource.onmessage = async (e) => {
    try {
      const line: string = JSON.parse(e.data)
      // Apply client-side level / keyword filter so live lines match current filters
      if (!matchesFilter(line)) return
      lines.value.push(line)
      // Trim buffer to avoid unbounded memory growth
      if (lines.value.length > 5000) lines.value.splice(0, lines.value.length - 5000)
      await nextTick()
      if (pinnedToBottom) scrollToBottom()
    } catch { /* ignore */ }
  }

  eventSource.onerror = () => {
    liveMode.value = false
    connecting.value = false
    eventSource?.close()
    eventSource = null
  }
}

function stopLive() {
  eventSource?.close()
  eventSource = null
  liveMode.value = false
  connecting.value = false
}

function matchesFilter(line: string): boolean {
  if (selectedLevel.value !== 'ALL' && !line.includes(`[${selectedLevel.value}`)) return false
  if (keyword.value && !line.toLowerCase().includes(keyword.value.toLowerCase())) return false
  return true
}

// ── Scroll helpers ────────────────────────────────────────────────────────────
function scrollToBottom() {
  bottomAnchor.value?.scrollIntoView({ behavior: 'auto' })
  pinnedToBottom = true
}

function onScroll() {
  const el = logContainer.value
  if (!el) return
  // Consider "pinned" when within 60px of the bottom
  pinnedToBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 60
}

// ── Line coloring ─────────────────────────────────────────────────────────────
function lineClass(line: string): string {
  if (line.includes('[ERROR]')) return 'text-red-400'
  if (line.includes('[WARN ') || line.includes('[WARN]')) return 'text-yellow-400'
  if (line.includes('[DEBUG]')) return 'text-gray-500'
  return 'text-gray-300'
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  await fetchDates()
  await loadLogs()
  scrollToBottom()
  logContainer.value?.addEventListener('scroll', onScroll, { passive: true })
})

onBeforeUnmount(() => {
  stopLive()
  logContainer.value?.removeEventListener('scroll', onScroll)
})
</script>
