<template>
  <div class="p-6">
    <div class="flex justify-between items-center mb-6">
      <div>
        <h2 class="text-2xl font-bold text-gray-800">模型优先级配置</h2>
        <p class="text-sm text-gray-400 mt-1">数字越大优先级越高，相同优先级内按权重随机负载均衡</p>
      </div>
      <el-button type="primary" :loading="saving" @click="saveAll">
        <el-icon class="mr-1"><Check /></el-icon>保存全部
      </el-button>
    </div>

    <div v-if="loading" class="text-center py-16 text-gray-400">
      <el-icon class="animate-spin" size="32"><Loading /></el-icon>
      <p class="mt-2">加载中...</p>
    </div>

    <template v-else>
      <!-- Group by virtualModel -->
      <div v-if="groups.length === 0" class="text-center py-16 text-gray-400">
        <el-icon size="48"><Sort /></el-icon>
        <p class="mt-2">暂无路由，请先在「上游渠道」中添加模型</p>
        <router-link to="/channels">
          <el-button class="mt-3" type="primary" plain>前往添加渠道</el-button>
        </router-link>
      </div>

      <div v-else class="space-y-4">
        <el-card
          v-for="group in groups"
          :key="group.virtualModel"
          shadow="never"
          class="border"
        >
          <template #header>
            <div class="flex items-center gap-2">
              <el-icon class="text-blue-500"><Share /></el-icon>
              <span class="font-semibold">虚拟模型：</span>
              <code class="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-sm">{{ group.virtualModel }}</code>
              <el-tag size="small" type="info">{{ group.routes.length }} 个上游</el-tag>
            </div>
          </template>

          <el-table :data="group.routes" size="small" row-key="id">
            <el-table-column label="上游渠道" min-width="140">
              <template #default="{ row }">
                <el-tag size="small" :type="providerTagType(row.channelProvider)">{{ row.channelName }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="实际模型名" min-width="160">
              <template #default="{ row }">
                <code class="text-xs bg-gray-100 px-2 py-0.5 rounded">{{ row.actualModel }}</code>
              </template>
            </el-table-column>
            <el-table-column label="优先级" width="160">
              <template #default="{ row }">
                <el-input-number
                  v-model="row._priority"
                  :min="1"
                  :max="999"
                  size="small"
                  style="width: 110px"
                />
              </template>
            </el-table-column>
            <el-table-column label="权重" width="160">
              <template #default="{ row }">
                <el-input-number
                  v-model="row._weight"
                  :min="1"
                  :max="100"
                  size="small"
                  style="width: 110px"
                />
              </template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-switch
                  v-model="row._enabled"
                  active-text="启用"
                  inactive-text="禁用"
                  size="small"
                />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80" align="center">
              <template #default="{ row }">
                <el-button
                  size="small"
                  type="danger"
                  plain
                  @click="deleteRoute(row.id, group.virtualModel)"
                >删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAdminStore } from '@/stores/admin'
import client from '@/api/client'

const adminStore = useAdminStore()
const loading = ref(false)
const saving = ref(false)

interface RouteRow {
  id: number
  virtualModel: string
  actualModel: string
  channelId: number
  channelName: string
  channelProvider: string
  priority: number
  weight: number
  enabled: boolean
  // mutable copies for editing
  _priority: number
  _weight: number
  _enabled: boolean
}

interface RouteGroup {
  virtualModel: string
  routes: RouteRow[]
}

const rows = ref<RouteRow[]>([])

const groups = computed<RouteGroup[]>(() => {
  const map = new Map<string, RouteRow[]>()
  for (const r of rows.value) {
    if (!map.has(r.virtualModel)) map.set(r.virtualModel, [])
    map.get(r.virtualModel)!.push(r)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([virtualModel, routes]) => ({
      virtualModel,
      routes: routes.slice().sort((a, b) => b._priority - a._priority),
    }))
})

const PROVIDERS: Record<string, 'primary' | 'warning' | 'info' | 'success'> = {
  openai: 'primary', anthropic: 'warning', custom: 'info', 'custom-anthropic': 'success',
}
function providerTagType(p: string) { return PROVIDERS[p] ?? 'info' }

async function loadRoutes() {
  loading.value = true
  try {
    // Fetch channels (includes modelRoutes)
    await adminStore.fetchChannels()
    const newRows: RouteRow[] = []
    for (const ch of adminStore.channels) {
      for (const r of ch.modelRoutes ?? []) {
        newRows.push({
          id: r.id,
          virtualModel: r.virtualModel,
          actualModel: r.actualModel,
          channelId: ch.id,
          channelName: ch.name,
          channelProvider: ch.provider,
          priority: r.priority,
          weight: r.weight,
          enabled: r.enabled,
          _priority: r.priority,
          _weight: r.weight,
          _enabled: r.enabled,
        })
      }
    }
    rows.value = newRows
  } finally {
    loading.value = false
  }
}

async function saveAll() {
  saving.value = true
  try {
    const changed = rows.value.filter(
      (r) => r._priority !== r.priority || r._weight !== r.weight || r._enabled !== r.enabled,
    )
    await Promise.all(
      changed.map((r) =>
        client.put(`/admin/routes/${r.id}`, {
          priority: r._priority,
          weight: r._weight,
          enabled: r._enabled,
        }),
      ),
    )
    // Update local state
    for (const r of changed) {
      r.priority = r._priority
      r.weight = r._weight
      r.enabled = r._enabled
    }
    ElMessage.success(`已保存 ${changed.length} 条路由优先级`)
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } } }
    ElMessage.error(e.response?.data?.error ?? '保存失败')
  } finally {
    saving.value = false
  }
}

async function deleteRoute(id: number, virtualModel: string) {
  await ElMessageBox.confirm(
    `确认删除该路由（${virtualModel}）？`,
    '删除确认',
    { type: 'warning' },
  )
  await client.delete(`/admin/routes/${id}`)
  rows.value = rows.value.filter((r) => r.id !== id)
  ElMessage.success('已删除')
}

onMounted(loadRoutes)
</script>
