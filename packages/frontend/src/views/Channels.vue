<template>
  <div class="p-6">
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold text-gray-800">上游渠道管理</h2>
      <el-button type="primary" @click="openCreate">
        <el-icon class="mr-1"><Plus /></el-icon>添加渠道
      </el-button>
    </div>

    <el-card shadow="never" class="border">
      <el-table :data="adminStore.channels" stripe v-loading="loading">
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column prop="name" label="名称" min-width="140" />
        <el-table-column prop="baseUrl" label="Base URL" min-width="200" show-overflow-tooltip />
        <el-table-column prop="provider" label="类型" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="providerTagType(row.provider)">{{ row.provider }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="路由数" width="80" align="center">
          <template #default="{ row }">{{ row._count?.modelRoutes ?? 0 }}</template>
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
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openEdit(row)">编辑</el-button>
            <el-button
              size="small"
              :type="row.enabled ? 'warning' : 'success'"
              @click="toggleEnabled(row)"
            >{{ row.enabled ? '禁用' : '启用' }}</el-button>
            <el-button size="small" type="danger" @click="handleDelete(row.id)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- Create / Edit Dialog -->
    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑渠道' : '添加渠道'"
      width="480px"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="渠道名称，如 OpenAI官方" />
        </el-form-item>
        <el-form-item label="类型" prop="provider">
          <el-select v-model="form.provider" class="w-full">
            <el-option label="OpenAI" value="openai" />
            <el-option label="Anthropic" value="anthropic" />
            <el-option label="自定义(OpenAI兼容)" value="custom" />
          </el-select>
        </el-form-item>
        <el-form-item label="Base URL" prop="baseUrl">
          <el-input v-model="form.baseUrl" placeholder="https://api.openai.com" />
        </el-form-item>
        <el-form-item label="API Key" :prop="editingId ? '' : 'apiKey'">
          <el-input
            v-model="form.apiKey"
            type="password"
            show-password
            :placeholder="editingId ? '留空则不修改' : '上游 API Key'"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import type { FormInstance } from 'element-plus'
import { useAdminStore, type Channel } from '@/stores/admin'

const adminStore = useAdminStore()
const loading = ref(false)
const saving = ref(false)
const dialogVisible = ref(false)
const editingId = ref<number | null>(null)
const formRef = ref<FormInstance>()

const form = reactive({ name: '', provider: 'openai', baseUrl: '', apiKey: '' })

const rules = {
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  provider: [{ required: true, message: '请选择类型', trigger: 'change' }],
  baseUrl: [{ required: true, message: '请输入 Base URL', trigger: 'blur' }],
  apiKey: [{ required: true, message: '请输入 API Key', trigger: 'blur' }],
}

function providerTagType(p: string) {
  return p === 'openai' ? '' : p === 'anthropic' ? 'warning' : 'info'
}

function formatDate(d: string) {
  return new Date(d).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function openCreate() {
  editingId.value = null
  Object.assign(form, { name: '', provider: 'openai', baseUrl: '', apiKey: '' })
  dialogVisible.value = true
}

function openEdit(channel: Channel) {
  editingId.value = channel.id
  Object.assign(form, { name: channel.name, provider: channel.provider, baseUrl: channel.baseUrl, apiKey: '' })
  dialogVisible.value = true
}

async function toggleEnabled(channel: Channel) {
  await adminStore.updateChannel(channel.id, { enabled: !channel.enabled })
  ElMessage.success('已更新')
}

async function handleSave() {
  await formRef.value?.validate(async (valid) => {
    if (!valid) return
    saving.value = true
    try {
      if (editingId.value) {
        const data: Record<string, unknown> = { name: form.name, provider: form.provider, baseUrl: form.baseUrl }
        if (form.apiKey) data.apiKey = form.apiKey
        await adminStore.updateChannel(editingId.value, data)
      } else {
        await adminStore.createChannel({ name: form.name, baseUrl: form.baseUrl, apiKey: form.apiKey, provider: form.provider })
      }
      dialogVisible.value = false
      ElMessage.success('保存成功')
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } }
      ElMessage.error(e.response?.data?.error ?? '保存失败')
    } finally {
      saving.value = false
    }
  })
}

async function handleDelete(id: number) {
  await ElMessageBox.confirm('确认删除该渠道？关联的路由也将被删除。', '删除确认', { type: 'warning' })
  await adminStore.deleteChannel(id)
  ElMessage.success('已删除')
}

onMounted(async () => {
  loading.value = true
  await adminStore.fetchChannels().finally(() => { loading.value = false })
})
</script>
