<template>
  <div class="p-6">
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold text-gray-800">API Keys 管理</h2>
      <el-button type="primary" @click="openCreate">
        <el-icon class="mr-1"><Plus /></el-icon>生成新 Key
      </el-button>
    </div>

    <!-- New key alert -->
    <el-alert
      v-if="newKeyPlain"
      type="success"
      class="mb-4"
      :closable="false"
    >
      <template #default>
        <div>
          <p class="font-semibold mb-1">✅ 新 API Key 已生成（请立即保存，之后无法再查看）</p>
          <div class="flex items-center gap-2 bg-gray-100 rounded px-3 py-2">
            <code class="flex-1 text-sm break-all text-gray-800 select-all">{{ newKeyPlain }}</code>
            <el-button size="small" type="primary" @click="copyKey">复制</el-button>
          </div>
          <el-button size="small" class="mt-2" @click="newKeyPlain = ''">我已保存，关闭提示</el-button>
        </div>
      </template>
    </el-alert>

    <el-card shadow="never" class="border">
      <el-table :data="keys" stripe v-loading="loading">
        <el-table-column prop="name" label="名称" min-width="160" />
        <el-table-column label="Key (前缀)" min-width="160">
          <template #default="{ row }">
            <code class="text-sm bg-gray-100 px-2 py-0.5 rounded">{{ row.keyPrefix }}…</code>
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
    </el-card>

    <!-- Create Dialog -->
    <el-dialog v-model="dialogVisible" title="生成新 API Key" width="380px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="为这个 Key 起个名字" />
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
import { ref, reactive, onMounted } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import type { FormInstance } from 'element-plus'
import client from '@/api/client'

interface ApiKey {
  id: number
  name: string
  keyPrefix: string
  enabled: boolean
  createdAt: string
  lastUsedAt: string | null
}

const keys = ref<ApiKey[]>([])
const loading = ref(false)
const saving = ref(false)
const dialogVisible = ref(false)
const newKeyPlain = ref('')
const formRef = ref<FormInstance>()
const form = reactive({ name: '' })
const rules = { name: [{ required: true, message: '请输入名称', trigger: 'blur' }] }

function formatDate(d: string) {
  return new Date(d).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
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
      const res = await client.post('/keys', { name: form.name })
      newKeyPlain.value = res.data.plainKey
      dialogVisible.value = false
      await fetchKeys()
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

function copyKey() {
  navigator.clipboard.writeText(newKeyPlain.value)
  ElMessage.success('已复制到剪贴板')
}

onMounted(fetchKeys)
</script>
