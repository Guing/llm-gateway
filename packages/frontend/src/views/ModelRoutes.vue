<template>
  <div class="p-6">
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold text-gray-800">模型路由管理</h2>
      <el-button type="primary" @click="openCreate">
        <el-icon class="mr-1"><Plus /></el-icon>添加路由
      </el-button>
    </div>

    <el-card shadow="never" class="border">
      <el-table :data="adminStore.modelRoutes" stripe v-loading="loading">
        <el-table-column prop="virtualModel" label="虚拟模型名（对外）" min-width="160" />
        <el-table-column label="→" width="40" align="center" />
        <el-table-column prop="actualModel" label="实际模型名" min-width="160" />
        <el-table-column label="渠道" min-width="140">
          <template #default="{ row }">
            <el-tag size="small" type="info">{{ row.channel?.name ?? '-' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="优先级" width="80" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="priorityTagType(row.priority)">{{ row.priority }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="weight" label="权重" width="70" align="center" />
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'success' : 'danger'" size="small">
              {{ row.enabled ? '启用' : '禁用' }}
            </el-tag>
          </template>
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

    <!-- Dialog -->
    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑路由' : '添加路由'"
      width="480px"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="虚拟模型名" prop="virtualModel">
          <el-input v-model="form.virtualModel" placeholder="对外暴露的模型名, 如 gpt-4" />
        </el-form-item>
        <el-form-item label="实际模型名" prop="actualModel">
          <el-input v-model="form.actualModel" placeholder="实际转发模型名, 如 qwen-max" />
        </el-form-item>
        <el-form-item label="上游渠道" prop="channelId">
          <el-select v-model="form.channelId" placeholder="选择渠道" class="w-full">
            <el-option
              v-for="ch in adminStore.channels"
              :key="ch.id"
              :label="ch.name + ' (' + ch.provider + ')'"
              :value="ch.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="优先级" prop="priority">
          <el-input-number v-model="form.priority" :min="1" :max="100" class="w-full" />
          <div class="text-xs text-gray-400 mt-1">数值越大优先级越高，相同优先级内按权重负载均衡</div>
        </el-form-item>
        <el-form-item label="权重" prop="weight">
          <el-input-number v-model="form.weight" :min="1" :max="100" class="w-full" />
          <div class="text-xs text-gray-400 mt-1">同优先级内的随机权重比例（1-100）</div>
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
import { useAdminStore, type ModelRoute } from '@/stores/admin'

const adminStore = useAdminStore()
const loading = ref(false)
const saving = ref(false)
const dialogVisible = ref(false)
const editingId = ref<number | null>(null)
const formRef = ref<FormInstance>()

const form = reactive<{ virtualModel: string; actualModel: string; channelId: number | undefined; priority: number; weight: number }>({ virtualModel: '', actualModel: '', channelId: undefined, priority: 1, weight: 100 })

const rules = {
  virtualModel: [{ required: true, message: '必填', trigger: 'blur' }],
  actualModel: [{ required: true, message: '必填', trigger: 'blur' }],
  channelId: [{ required: true, message: '请选择渠道', trigger: 'change' }],
}

function priorityTagType(p: number) {
  if (p >= 8) return 'danger'
  if (p >= 4) return 'warning'
  return 'info'
}

function openCreate() {
  editingId.value = null
  Object.assign(form, { virtualModel: '', actualModel: '', channelId: undefined, priority: 1, weight: 100 })
  dialogVisible.value = true
}

function openEdit(route: ModelRoute) {
  editingId.value = route.id
  Object.assign(form, { virtualModel: route.virtualModel, actualModel: route.actualModel, channelId: route.channelId, priority: route.priority, weight: route.weight })
  dialogVisible.value = true
}

async function toggleEnabled(route: ModelRoute) {
  await adminStore.updateModelRoute(route.id, { enabled: !route.enabled })
  ElMessage.success('已更新')
}

async function handleSave() {
  await formRef.value?.validate(async (valid) => {
    if (!valid) return
    saving.value = true
    try {
      if (editingId.value) {
        await adminStore.updateModelRoute(editingId.value, { ...form })
      } else {
        await adminStore.createModelRoute({ ...form, channelId: form.channelId! })
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
  await ElMessageBox.confirm('确认删除该路由？', '删除确认', { type: 'warning' })
  await adminStore.deleteModelRoute(id)
  ElMessage.success('已删除')
}

onMounted(async () => {
  loading.value = true
  await Promise.all([adminStore.fetchModelRoutes(), adminStore.fetchChannels()])
  loading.value = false
})
</script>
