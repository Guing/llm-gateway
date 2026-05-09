<template>
  <div class="p-6 space-y-5">
    <!-- Header -->
    <div class="flex items-center justify-between flex-wrap gap-3">
      <h2 class="text-2xl font-bold text-gray-800">数据分析</h2>
      <div class="flex items-center gap-2 flex-wrap">
        <el-radio-group v-model="days" size="small" @change="onDaysChange">
          <el-radio-button :value="7">近 7 天</el-radio-button>
          <el-radio-button :value="30">近 30 天</el-radio-button>
          <el-radio-button :value="90">近 90 天</el-radio-button>
        </el-radio-group>
        <span class="text-gray-400 text-xs select-none">或</span>
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          size="small"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          :disabled-date="disabledDate"
          value-format="YYYY-MM-DD"
          style="width: 240px"
          @change="onDateRangeChange"
          @clear="onDateRangeClear"
          clearable
        />
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center h-64 text-gray-400">
      <el-icon class="is-loading mr-2" size="24"><Loading /></el-icon>
      <span>加载中…</span>
    </div>

    <template v-else>
      <!-- 1. Overview Cards -->
      <div class="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        <el-card
          v-for="card in overviewCards"
          :key="card.label"
          shadow="never"
          class="border"
        >
          <p class="text-xs text-gray-500 truncate">{{ card.label }}</p>
          <p class="text-xl font-bold mt-1" :class="card.color">{{ card.value }}</p>
        </el-card>
      </div>

      <!-- 2. Request Trend -->
      <el-card shadow="never" class="border">
        <template #header>
          <span class="font-semibold text-gray-700">请求量趋势（成功 vs 错误）</span>
        </template>
        <div ref="requestTrendEl" style="height: 260px"></div>
      </el-card>

      <!-- 3. Token Trend -->
      <el-card shadow="never" class="border">
        <template #header>
          <span class="font-semibold text-gray-700">每日 Token 用量（输入 vs 输出）</span>
        </template>
        <div ref="tokenTrendEl" style="height: 260px"></div>
      </el-card>

      <!-- 4. Model Distribution + Channel Stats -->
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <el-card shadow="never" class="border">
          <template #header>
            <span class="font-semibold text-gray-700">虚拟模型请求分布</span>
          </template>
          <div ref="modelDistEl" style="height: 300px"></div>
        </el-card>
        <el-card shadow="never" class="border">
          <template #header>
            <span class="font-semibold text-gray-700">各渠道请求量 & 错误率</span>
          </template>
          <div
            ref="channelStatsEl"
            :style="{ height: Math.max(260, channelStats.length * 36 + 80) + 'px' }"
          ></div>
        </el-card>
      </div>

      <!-- 5. Response Time Trend -->
      <el-card shadow="never" class="border">
        <template #header>
          <span class="font-semibold text-gray-700">响应时间趋势（ms）</span>
        </template>
        <div ref="rtTrendEl" style="height: 240px"></div>
      </el-card>

      <!-- 6. Error Analysis -->
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <el-card shadow="never" class="border">
          <template #header>
            <span class="font-semibold text-gray-700">每日错误率趋势</span>
          </template>
          <div ref="errorTrendEl" style="height: 260px"></div>
        </el-card>
        <el-card shadow="never" class="border">
          <template #header>
            <span class="font-semibold text-gray-700">HTTP 状态码分布</span>
          </template>
          <div ref="statusPieEl" style="height: 260px"></div>
        </el-card>
      </div>

      <!-- 7. Channel × Model Token Chart -->
      <el-card shadow="never" class="border">
        <template #header>
          <span class="font-semibold text-gray-700">各渠道各模型 Token 用量 Top 20（输入 + 输出）</span>
        </template>
        <div ref="cmTokenChartEl" style="height: 420px"></div>
      </el-card>

      <!-- 8. Channel × Model Token Table -->
      <el-card shadow="never" class="border">
        <template #header>
          <span class="font-semibold text-gray-700">渠道 × 模型 Token 明细</span>
        </template>
        <el-table :data="cmTokenData" size="small" stripe max-height="400">
          <el-table-column prop="channelName" label="渠道" min-width="120" />
          <el-table-column prop="actualModel" label="实际模型" min-width="160" />
          <el-table-column prop="requests" label="请求数" width="90" align="right" sortable />
          <el-table-column label="输入 Tokens" width="120" align="right" sortable :sort-method="(a: any, b: any) => a.promptTokens - b.promptTokens">
            <template #default="{ row }">{{ fmtNum(row.promptTokens) }}</template>
          </el-table-column>
          <el-table-column label="输出 Tokens" width="120" align="right" sortable :sort-method="(a: any, b: any) => a.completionTokens - b.completionTokens">
            <template #default="{ row }">{{ fmtNum(row.completionTokens) }}</template>
          </el-table-column>
          <el-table-column label="总 Tokens" width="110" align="right" sortable :sort-method="(a: any, b: any) => a.totalTokens - b.totalTokens">
            <template #default="{ row }">
              <span class="font-semibold text-blue-600">{{ fmtNum(row.totalTokens) }}</span>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- 9. Top Users -->
      <el-card shadow="never" class="border">
        <template #header>
          <span class="font-semibold text-gray-700">用户活跃度排行 Top 10</span>
        </template>
        <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div ref="topUserReqEl" style="height: 280px"></div>
          <div ref="topUserTokenEl" style="height: 280px"></div>
        </div>
      </el-card>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick } from 'vue'
import * as echarts from 'echarts'
import client from '@/api/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Overview {
  totalRequests: number
  errorRequests: number
  errorRate: number
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  avgDurationMs: number
  totalUsers: number
  activeChannels: number
}

interface TrendPoint { day: string; total: number; errors: number; success: number }
interface TokenPoint { day: string; promptTokens: number; completionTokens: number }
interface ModelDist { virtualModel: string; requests: number; totalTokens: number }
interface ChannelStat {
  channelId: number | null
  channelName: string
  requests: number
  errors: number
  errorRate: number
  avgDurationMs: number | null
  totalTokens: number
}
interface RtPoint { day: string; avgDuration: number | null; maxDuration: number | null }
interface ErrTrendPoint { day: string; total: number; errors: number; errorRate: number }
interface StatusPoint { statusCode: number | null; count: number }
interface ErrorAnalysis { trend: ErrTrendPoint[]; statusCodes: StatusPoint[] }
interface TopUser {
  userId: number
  email: string
  requests: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
}
interface CmToken {
  channelName: string
  actualModel: string
  requests: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

// ─── State ────────────────────────────────────────────────────────────────────

const days = ref<number | null>(30)
const dateRange = ref<[string, string] | null>(null)
const loading = ref(true)

const overview = ref<Overview | null>(null)
const requestTrend = ref<TrendPoint[]>([])
const tokenTrend = ref<TokenPoint[]>([])
const modelDist = ref<ModelDist[]>([])
const channelStats = ref<ChannelStat[]>([])
const rtTrend = ref<RtPoint[]>([])
const errorAnalysis = ref<ErrorAnalysis>({ trend: [], statusCodes: [] })
const topUsers = ref<TopUser[]>([])
const cmTokenData = ref<CmToken[]>([])

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const requestTrendEl = ref<HTMLElement | null>(null)
const tokenTrendEl = ref<HTMLElement | null>(null)
const modelDistEl = ref<HTMLElement | null>(null)
const channelStatsEl = ref<HTMLElement | null>(null)
const rtTrendEl = ref<HTMLElement | null>(null)
const errorTrendEl = ref<HTMLElement | null>(null)
const statusPieEl = ref<HTMLElement | null>(null)
const cmTokenChartEl = ref<HTMLElement | null>(null)
const topUserReqEl = ref<HTMLElement | null>(null)
const topUserTokenEl = ref<HTMLElement | null>(null)

// ─── ECharts instance registry ────────────────────────────────────────────────

const chartInstances: echarts.ECharts[] = []

function mountChart(
  el: HTMLElement | null,
  options: echarts.EChartsOption,
): void {
  if (!el) return
  const existing = echarts.getInstanceByDom(el)
  if (existing) existing.dispose()
  const chart = echarts.init(el)
  chart.setOption(options)
  chartInstances.push(chart)
}

function disposeAll() {
  chartInstances.forEach((c) => { try { c.dispose() } catch { /* noop */ } })
  chartInstances.length = 0
}

function onResize() {
  chartInstances.forEach((c) => { try { c.resize() } catch { /* noop */ } })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

const PALETTE = [
  '#3b82f6', '#22c55e', '#ef4444', '#f97316', '#8b5cf6',
  '#14b8a6', '#eab308', '#ec4899', '#6366f1', '#84cc16',
  '#06b6d4', '#a855f7', '#f43f5e', '#10b981', '#fb923c',
]

// ─── Overview cards ───────────────────────────────────────────────────────────

const overviewCards = computed(() => {
  const o = overview.value
  if (!o) return []
  return [
    { label: '总请求数', value: fmtNum(o.totalRequests), color: 'text-blue-600' },
    { label: '总 Token 用量', value: fmtNum(o.totalTokens), color: 'text-purple-600' },
    {
      label: '错误率',
      value: `${o.errorRate.toFixed(1)}%`,
      color: o.errorRate > 5 ? 'text-red-600' : 'text-green-600',
    },
    { label: '平均响应时间', value: `${o.avgDurationMs} ms`, color: 'text-orange-500' },
    { label: '用户数', value: String(o.totalUsers), color: 'text-gray-700' },
    { label: '活跃渠道', value: String(o.activeChannels), color: 'text-teal-600' },
  ]
})

// ─── Date filter helpers ─────────────────────────────────────────────────────

/** Build query string for API requests based on current filter mode */
function buildDateParams(): string {
  if (dateRange.value) {
    const [start, end] = dateRange.value
    return `startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`
  }
  return `days=${days.value ?? 30}`
}

/** Cannot pick future dates */
function disabledDate(d: Date): boolean {
  return d > new Date()
}

function onDaysChange() {
  dateRange.value = null
  reload()
}

function onDateRangeChange(val: [string, string] | null) {
  if (!val) return
  days.value = null
  reload()
}

function onDateRangeClear() {
  dateRange.value = null
  days.value = 30
  reload()
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function loadData() {
  loading.value = true
  try {
    const q = buildDateParams()
    const [ovRes, reqRes, tokRes, mdRes, csRes, rtRes, eaRes, tuRes, cmRes] =
      await Promise.all([
        client.get(`/admin/analytics/overview?${q}`),
        client.get(`/admin/analytics/request-trend?${q}`),
        client.get(`/admin/analytics/token-trend?${q}`),
        client.get(`/admin/analytics/model-distribution?${q}`),
        client.get(`/admin/analytics/channel-stats?${q}`),
        client.get(`/admin/analytics/response-time-trend?${q}`),
        client.get(`/admin/analytics/error-analysis?${q}`),
        client.get(`/admin/analytics/top-users?limit=10&${q}`),
        client.get(`/admin/analytics/channel-model-tokens?${q}`),
      ])
    overview.value = ovRes.data
    requestTrend.value = reqRes.data
    tokenTrend.value = tokRes.data
    modelDist.value = mdRes.data
    channelStats.value = csRes.data
    rtTrend.value = rtRes.data
    errorAnalysis.value = eaRes.data
    topUsers.value = tuRes.data
    cmTokenData.value = cmRes.data
  } finally {
    loading.value = false
  }
}

// ─── Chart builders ───────────────────────────────────────────────────────────

function buildRequestTrend() {
  const data = requestTrend.value
  mountChart(requestTrendEl.value, {
    tooltip: { trigger: 'axis' },
    legend: { data: ['成功', '错误'], bottom: 0 },
    grid: { left: 50, right: 20, top: 20, bottom: 40 },
    xAxis: { type: 'category', data: data.map((d) => d.day), axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      {
        name: '成功',
        type: 'line',
        data: data.map((d) => d.success),
        smooth: true,
        color: '#22c55e',
        areaStyle: { opacity: 0.08 },
      },
      {
        name: '错误',
        type: 'line',
        data: data.map((d) => d.errors),
        smooth: true,
        color: '#ef4444',
        areaStyle: { opacity: 0.08 },
      },
    ],
  })
}

function buildTokenTrend() {
  const data = tokenTrend.value
  mountChart(tokenTrendEl.value, {
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const p = params as Array<{ seriesName: string; value: number; axisValue: string }>
        if (!p.length) return ''
        const lines = p.map((item) => `${item.seriesName}: ${fmtNum(item.value)}`)
        return `${p[0].axisValue}<br/>${lines.join('<br/>')}`
      },
    },
    legend: { data: ['输入 Tokens', '输出 Tokens'], bottom: 0 },
    grid: { left: 60, right: 20, top: 20, bottom: 40 },
    xAxis: { type: 'category', data: data.map((d) => d.day), axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => fmtNum(v) } },
    series: [
      {
        name: '输入 Tokens',
        type: 'bar',
        stack: 'token',
        data: data.map((d) => d.promptTokens),
        color: '#3b82f6',
      },
      {
        name: '输出 Tokens',
        type: 'bar',
        stack: 'token',
        data: data.map((d) => d.completionTokens),
        color: '#8b5cf6',
      },
    ],
  })
}

function buildModelDist() {
  const data = modelDist.value.slice(0, 15)
  mountChart(modelDistEl.value, {
    tooltip: { trigger: 'item', formatter: '{b}: {c} 次 ({d}%)' },
    legend: {
      type: 'scroll',
      orient: 'vertical',
      right: 10,
      top: 20,
      bottom: 20,
      textStyle: { fontSize: 11 },
    },
    series: [
      {
        type: 'pie',
        radius: ['35%', '65%'],
        center: ['36%', '50%'],
        data: data.map((d, i) => ({
          name: d.virtualModel,
          value: d.requests,
          itemStyle: { color: PALETTE[i % PALETTE.length] },
        })),
        label: { show: false },
        emphasis: { label: { show: true, fontSize: 13, fontWeight: 'bold' } },
      },
    ],
  })
}

function buildChannelStats() {
  const data = [...channelStats.value].sort((a, b) => b.requests - a.requests)
  const names = data.map((d) => d.channelName)

  mountChart(channelStatsEl.value, {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: ['请求数', '错误率(%)'], bottom: 0 },
    grid: { left: 100, right: 60, top: 20, bottom: 40 },
    xAxis: [
      { type: 'value', name: '请求数', nameTextStyle: { fontSize: 11 }, minInterval: 1 },
      { type: 'value', name: '错误率(%)', nameTextStyle: { fontSize: 11 }, min: 0, max: 100 },
    ],
    yAxis: {
      type: 'category',
      data: names,
      axisLabel: { fontSize: 11, width: 90, overflow: 'truncate' },
    },
    series: [
      {
        name: '请求数',
        type: 'bar',
        xAxisIndex: 0,
        data: data.map((d) => d.requests),
        color: '#3b82f6',
        label: { show: true, position: 'right', fontSize: 11 },
      },
      {
        name: '错误率(%)',
        type: 'line',
        xAxisIndex: 1,
        data: data.map((d) => +d.errorRate.toFixed(1)),
        color: '#ef4444',
        symbol: 'circle',
        symbolSize: 6,
      },
    ],
  })
}

function buildRtTrend() {
  const data = rtTrend.value
  mountChart(rtTrendEl.value, {
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const p = params as Array<{ seriesName: string; value: number | null; axisValue: string }>
        if (!p.length) return ''
        const lines = p
          .filter((item) => item.value != null)
          .map((item) => `${item.seriesName}: ${item.value} ms`)
        return `${p[0].axisValue}<br/>${lines.join('<br/>')}`
      },
    },
    legend: { data: ['平均响应时间', '最大响应时间'], bottom: 0 },
    grid: { left: 70, right: 20, top: 20, bottom: 40 },
    xAxis: { type: 'category', data: data.map((d) => d.day), axisLabel: { fontSize: 11 } },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: (v: number) => `${v}ms` },
    },
    series: [
      {
        name: '平均响应时间',
        type: 'line',
        data: data.map((d) => d.avgDuration),
        smooth: true,
        color: '#f97316',
      },
      {
        name: '最大响应时间',
        type: 'line',
        data: data.map((d) => d.maxDuration),
        smooth: true,
        color: '#ef4444',
        lineStyle: { type: 'dashed' },
      },
    ],
  })
}

function buildErrorTrend() {
  const data = errorAnalysis.value.trend
  mountChart(errorTrendEl.value, {
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const p = params as Array<{ value: number; axisValue: string }>
        if (!p.length) return ''
        return `${p[0].axisValue}<br/>错误率: ${Number(p[0].value).toFixed(1)}%`
      },
    },
    grid: { left: 55, right: 20, top: 20, bottom: 40 },
    xAxis: { type: 'category', data: data.map((d) => d.day), axisLabel: { fontSize: 11 } },
    yAxis: {
      type: 'value',
      min: 0,
      axisLabel: { formatter: (v: number) => `${v}%` },
    },
    series: [
      {
        name: '错误率',
        type: 'line',
        data: data.map((d) => +d.errorRate.toFixed(2)),
        smooth: true,
        color: '#ef4444',
        areaStyle: { opacity: 0.1 },
      },
    ],
  })
}

function buildStatusPie() {
  const data = errorAnalysis.value.statusCodes
  const statusColor = (code: number | null): string => {
    if (!code) return '#94a3b8'
    if (code >= 200 && code < 300) return '#22c55e'
    if (code >= 400 && code < 500) return '#f97316'
    if (code >= 500) return '#ef4444'
    return '#94a3b8'
  }

  mountChart(statusPieEl.value, {
    tooltip: { trigger: 'item', formatter: '{b}: {c} 次 ({d}%)' },
    legend: {
      orient: 'vertical',
      right: 10,
      top: 'center',
      textStyle: { fontSize: 11 },
    },
    series: [
      {
        type: 'pie',
        radius: ['35%', '65%'],
        center: ['38%', '50%'],
        data: data.map((d) => ({
          name: `HTTP ${d.statusCode ?? 'N/A'}`,
          value: d.count,
          itemStyle: { color: statusColor(d.statusCode) },
        })),
        label: { show: false },
        emphasis: { label: { show: true, fontWeight: 'bold' } },
      },
    ],
  })
}

function buildCmTokenChart() {
  const top20 = [...cmTokenData.value]
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 20)

  const labels = top20.map((d) => {
    const label = `${d.channelName} / ${d.actualModel}`
    return label.length > 30 ? label.slice(0, 28) + '…' : label
  })

  mountChart(cmTokenChartEl.value, {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const p = params as Array<{ seriesName: string; value: number; axisValue: string }>
        if (!p.length) return ''
        const total = p.reduce((s, item) => s + item.value, 0)
        const lines = p.map((item) => `${item.seriesName}: ${fmtNum(item.value)}`)
        return `${p[0].axisValue}<br/>${lines.join('<br/>')}<br/><b>合计: ${fmtNum(total)}</b>`
      },
    },
    legend: { data: ['输入 Tokens', '输出 Tokens'], bottom: 0 },
    grid: { left: 200, right: 60, top: 20, bottom: 50 },
    xAxis: {
      type: 'value',
      axisLabel: { formatter: (v: number) => fmtNum(v) },
    },
    yAxis: {
      type: 'category',
      data: labels,
      axisLabel: { fontSize: 11, width: 190, overflow: 'truncate' },
    },
    series: [
      {
        name: '输入 Tokens',
        type: 'bar',
        stack: 'tokens',
        data: top20.map((d) => d.promptTokens),
        color: '#3b82f6',
      },
      {
        name: '输出 Tokens',
        type: 'bar',
        stack: 'tokens',
        data: top20.map((d) => d.completionTokens),
        color: '#8b5cf6',
        label: {
          show: true,
          position: 'right',
          fontSize: 11,
          formatter: (params: unknown) => {
            const p = params as { dataIndex: number }
            return fmtNum(top20[p.dataIndex].totalTokens)
          },
        },
      },
    ],
  })
}

function buildTopUsers() {
  const byReq = [...topUsers.value].sort((a, b) => b.requests - a.requests)
  const byTok = [...topUsers.value].sort((a, b) => b.totalTokens - a.totalTokens)

  mountChart(topUserReqEl.value, {
    title: {
      text: '请求数排行',
      textStyle: { fontSize: 13, fontWeight: 'normal', color: '#6b7280' },
      top: 5,
      left: 10,
    },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 130, right: 60, top: 40, bottom: 10 },
    xAxis: { type: 'value', minInterval: 1 },
    yAxis: {
      type: 'category',
      data: byReq.map((d) => d.email),
      axisLabel: { fontSize: 11, width: 120, overflow: 'truncate' },
    },
    series: [
      {
        type: 'bar',
        data: byReq.map((d) => d.requests),
        color: '#3b82f6',
        label: { show: true, position: 'right', fontSize: 11 },
      },
    ],
  })

  mountChart(topUserTokenEl.value, {
    title: {
      text: 'Token 用量排行',
      textStyle: { fontSize: 13, fontWeight: 'normal', color: '#6b7280' },
      top: 5,
      left: 10,
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const p = params as Array<{ seriesName: string; value: number; axisValue: string }>
        if (!p.length) return ''
        const total = p.reduce((s, item) => s + item.value, 0)
        const lines = p.map((item) => `${item.seriesName}: ${fmtNum(item.value)}`)
        return `${p[0].axisValue}<br/>${lines.join('<br/>')}<br/><b>合计: ${fmtNum(total)}</b>`
      },
    },
    legend: { data: ['输入 Tokens', '输出 Tokens'], bottom: 0 },
    grid: { left: 130, right: 80, top: 40, bottom: 40 },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => fmtNum(v) } },
    yAxis: {
      type: 'category',
      data: byTok.map((d) => d.email),
      axisLabel: { fontSize: 11, width: 120, overflow: 'truncate' },
    },
    series: [
      {
        name: '输入 Tokens',
        type: 'bar',
        stack: 'tok',
        data: byTok.map((d) => d.promptTokens),
        color: '#3b82f6',
      },
      {
        name: '输出 Tokens',
        type: 'bar',
        stack: 'tok',
        data: byTok.map((d) => d.completionTokens),
        color: '#8b5cf6',
        label: {
          show: true,
          position: 'right',
          fontSize: 11,
          formatter: (params: unknown) => {
            const p = params as { dataIndex: number }
            return fmtNum(byTok[p.dataIndex].totalTokens)
          },
        },
      },
    ],
  })
}

// ─── Render all charts ────────────────────────────────────────────────────────

function renderCharts() {
  nextTick(() => {
    disposeAll()
    buildRequestTrend()
    buildTokenTrend()
    buildModelDist()
    buildChannelStats()
    buildRtTrend()
    buildErrorTrend()
    buildStatusPie()
    buildCmTokenChart()
    buildTopUsers()
  })
}

async function reload() {
  await loadData()
  renderCharts()
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(async () => {
  window.addEventListener('resize', onResize)
  await loadData()
  renderCharts()
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  disposeAll()
})
</script>
