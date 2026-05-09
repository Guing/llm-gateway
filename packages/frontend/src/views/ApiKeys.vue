<template>
  <div class="p-6">
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold text-gray-800">API Keys 管理</h2>
      <el-button type="primary" @click="openCreate">
        <el-icon class="mr-1"><Plus /></el-icon>生成新 Key
      </el-button>
    </div>

    <el-card shadow="never" class="border">
      <el-table :data="paginatedKeys" stripe v-loading="loading">
        <el-table-column prop="name" label="名称" min-width="140" />
        <el-table-column label="API Key" min-width="320">
          <template #default="{ row }">
            <div v-if="row.plainKey" class="flex items-center gap-2">
              <code class="text-sm bg-gray-100 px-2 py-0.5 rounded flex-1 break-all select-all">
                {{ visibleKeys.has(row.id) ? row.plainKey : maskKey(row.plainKey) }}
              </code>
              <el-tooltip :content="visibleKeys.has(row.id) ? '隐藏' : '显示'" placement="top">
                <el-button size="small" text @click="toggleVisible(row.id)">
                  <el-icon><View v-if="!visibleKeys.has(row.id)" /><Hide v-else /></el-icon>
                </el-button>
              </el-tooltip>
              <el-tooltip content="复制" placement="top">
                <el-button size="small" text @click="copyKey(row.plainKey)">
                  <el-icon><CopyDocument /></el-icon>
                </el-button>
              </el-tooltip>
            </div>
            <el-tooltip v-else content="该 Key 在加密存储功能上线前创建，原始值已无法恢复，请删除后重新创建" placement="top">
              <span class="text-xs text-gray-400 italic cursor-default">{{ row.keyPrefix }}… <span class="text-orange-400">[旧密钥，请重新创建]</span></span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'success' : 'danger'" size="small">
              {{ row.enabled ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="160">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="最后使用" width="160">
          <template #default="{ row }">
            {{ row.lastUsedAt ? formatDate(row.lastUsedAt) : '从未使用' }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button size="small" :type="row.enabled ? 'warning' : 'success'" @click="toggle(row.id)">
              {{ row.enabled ? '禁用' : '启用' }}
            </el-button>
            <el-button size="small" type="danger" @click="handleDelete(row.id)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="mt-4 flex justify-end">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="keys.length"
          layout="total, sizes, prev, pager, next"
          background
          @size-change="currentPage = 1"
        />
      </div>
    </el-card>

    <!-- Create Dialog -->
    <el-dialog v-model="dialogVisible" title="生成新 API Key" width="380px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px" @submit.prevent>
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="为这个 Key 起个名字" @keyup.enter="handleCreate" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleCreate">生成</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import type { FormInstance } from 'element-plus'
import { View, Hide, CopyDocument } from '@element-plus/icons-vue'
import client from '@/api/client'

interface ApiKey {
  id: number
  name: string
  keyPrefix: string
  plainKey: string | null
  enabled: boolean
  createdAt: string
  lastUsedAt: string | null
}

const keys = ref<ApiKey[]>([])
const loading = ref(false)
const currentPage = ref(1)
const pageSize = ref(20)
const paginatedKeys = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return keys.value.slice(start, start + pageSize.value)
})
const saving = ref(false)
const dialogVisible = ref(false)
const formRef = ref<FormInstance>()
const form = reactive({ name: '' })
const rules = { name: [{ required: true, message: '请输入名称', trigger: 'blur' }] }

// Track which key IDs are currently visible (unmasked)
const visibleKeys = ref<Set<number>>(new Set())

function formatDate(d: string) {
  return new Date(d).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function maskKey(key: string): string {
  if (!key) return '••••••••'
  return key.substring(0, 12) + '••••••••••••••••••••'
}

function toggleVisible(id: number) {
  if (visibleKeys.value.has(id)) visibleKeys.value.delete(id)
  else visibleKeys.value.add(id)
}

async function fetchKeys() {
  loading.value = true
  const res = await client.get('/keys')
  keys.value = res.data
  loading.value = false
}

function openCreate() {
  form.name = ''
  dialogVisible.value = true
}

async function handleCreate() {
  await formRef.value?.validate(async (valid) => {
    if (!valid) return
    saving.value = true
    try {
      await client.post('/keys', { name: form.name })
      dialogVisible.value = false
      await fetchKeys()
      ElMessage.success('API Key 已生成')
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } }
      ElMessage.error(e.response?.data?.error ?? '生成失败')
    } finally {
      saving.value = false
    }
  })
}

async function toggle(id: number) {
  await client.patch(`/keys/${id}/toggle`)
  await fetchKeys()
}

async function handleDelete(id: number) {
  await ElMessageBox.confirm('确认删除该 API Key？', '删除确认', { type: 'warning' })
  await client.delete(`/keys/${id}`)
  await fetchKeys()
  ElMessage.success('已删除')
}

function copyKey(key: string) {
  navigator.clipboard.writeText(key)
  ElMessage.success('已复制到剪贴板')
}

onMounted(fetchKeys)
</script>
