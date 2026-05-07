<template>
  <div class="p-6">
    <h2 class="text-2xl font-bold text-gray-800 mb-6">仪表盘</h2>

    <!-- Stats cards -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <el-card v-for="stat in statCards" :key="stat.label" shadow="never" class="border">
        <div class="flex items-center gap-3">
          <div :class="['w-10 h-10 rounded-lg flex items-center justify-center text-white', stat.color]">
            <el-icon size="20"><component :is="stat.icon" /></el-icon>
          </div>
          <div>
            <p class="text-2xl font-bold text-gray-800">{{ stat.value }}</p>
            <p class="text-xs text-gray-500">{{ stat.label }}</p>
          </div>
        </div>
      </el-card>
    </div>

    <!-- Recent logs table -->
    <el-card shadow="never" class="border">
      <template #header>
        <div class="flex justify-between items-center">
          <span class="font-semibold text-gray-700">最近请求</span>
          <router-link to="/logs">
            <el-button size="small" type="primary" plain>查看全部</el-button>
          </router-link>
        </div>
      </template>

      <el-table :data="recentLogs" stripe size="small" v-loading="loading">
        <el-table-column label="时间" width="160">
          <template #default="{ row }">
            {{ formatTime(row.requestedAt) }}
          </template>
        </el-table-column>
        <el-table-column prop="user.email" label="用户" min-width="140" show-overflow-tooltip />
        <el-table-column prop="virtualModel" label="模型" width="140" />
        <el-table-column label="耗时" width="90">
          <template #default="{ row }">
            {{ row.duration != null ? row.duration + 'ms' : '-' }}
          </template>
        </el-table-column>
        <el-table-column label="Tokens" width="100">
          <template #default="{ row }">
            {{ row.completionTokens ?? '-' }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.errorMessage ? 'danger' : 'success'" size="small">
              {{ row.errorMessage ? '失败' : '成功' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="流式" width="60">
          <template #default="{ row }">
            <el-tag v-if="row.isStreaming" type="info" size="small">SSE</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAdminStore } from '@/stores/admin'
import { useLogsStore } from '@/stores/logs'
import { useAuthStore } from '@/stores/auth'

const adminStore = useAdminStore()
const logsStore = useLogsStore()
const authStore = useAuthStore()
const loading = ref(false)

const statCards = computed(() => [
  {
    label: '总请求数',
    value: adminStore.stats.totalRequests,
    icon: 'DataAnalysis',
    color: 'bg-blue-500',
  },
  {
    label: '注册用户',
    value: adminStore.stats.totalUsers,
    icon: 'UserFilled',
    color: 'bg-green-500',
  },
  {
    label: '活跃渠道',
    value: adminStore.stats.activeChannels,
    icon: 'Connection',
    color: 'bg-purple-500',
  },
  {
    label: '近24h错误',
    value: adminStore.stats.recentErrors,
    icon: 'Warning',
    color: 'bg-red-500',
  },
])

const recentLogs = computed(() => logsStore.logs.slice(0, 10))

function formatTime(t: string) {
  return new Date(t).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

onMounted(async () => {
  loading.value = true
  try {
    const fetchPromises: Promise<void>[] = [logsStore.fetchLogs({ limit: 10 })]
    if (authStore.isAdmin) {
      fetchPromises.push(adminStore.fetchStats())
    }
    await Promise.all(fetchPromises)
  } finally {
    loading.value = false
  }
})
</script>
