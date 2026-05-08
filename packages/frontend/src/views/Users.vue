<template>
  <div class="p-6">
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold text-gray-800">用户管理</h2>
      <el-button type="primary" @click="openCreate">
        <el-icon class="mr-1"><Plus /></el-icon>添加用户
      </el-button>
    </div>

    <el-card shadow="never" class="border">
      <el-table :data="paginatedUsers" stripe v-loading="loading">
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column prop="email" label="邮箱" min-width="200" />
        <el-table-column prop="role" label="角色" width="90">
          <template #default="{ row }">
            <el-tag :type="row.role === 'admin' ? 'danger' : 'info'" size="small">{{ row.role }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="API Keys" width="90" align="center">
          <template #default="{ row }">{{ row._count?.apiKeys ?? 0 }}</template>
        </el-table-column>
        <el-table-column label="请求数" width="90" align="center">
          <template #default="{ row }">{{ row._count?.requestLogs ?? 0 }}</template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'success' : 'danger'" size="small">
              {{ row.enabled ? '正常' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="160">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
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
      <div class="mt-4 flex justify-end">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="adminStore.users.length"
          layout="total, sizes, prev, pager, next"
          background
          @size-change="currentPage = 1"
        />
      </div>
    </el-card>

    <!-- Dialog -->
    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑用户' : '添加用户'" width="420px">
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="80px" @submit.prevent>
        <el-form-item label="邮箱" prop="email">
          <el-input v-model="form.email" :disabled="!!editingId" />
        </el-form-item>
        <el-form-item label="密码" :prop="editingId ? '' : 'password'">
          <el-input v-model="form.password" type="password" show-password :placeholder="editingId ? '留空则不修改' : '密码'" />
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="form.role" class="w-full">
            <el-option label="普通用户" value="user" />
            <el-option label="管理员" value="admin" />
          </el-select>
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
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import type { FormInstance } from 'element-plus'
import { useAdminStore, type AdminUser } from '@/stores/admin'

const adminStore = useAdminStore()
const loading = ref(false)
const currentPage = ref(1)
const pageSize = ref(20)
const paginatedUsers = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return adminStore.users.slice(start, start + pageSize.value)
})
const saving = ref(false)
const dialogVisible = ref(false)
const editingId = ref<number | null>(null)
const formRef = ref<FormInstance>()

const form = reactive({ email: '', password: '', role: 'user' })

const formRules = {
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email' as const, message: '无效邮箱', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '至少6位', trigger: 'blur' },
  ],
}

function formatDate(d: string) {
  return new Date(d).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function openCreate() {
  editingId.value = null
  Object.assign(form, { email: '', password: '', role: 'user' })
  dialogVisible.value = true
}

function openEdit(user: AdminUser) {
  editingId.value = user.id
  Object.assign(form, { email: user.email, password: '', role: user.role })
  dialogVisible.value = true
}

async function toggleEnabled(user: AdminUser) {
  await adminStore.updateUser(user.id, { enabled: !user.enabled })
  ElMessage.success('已更新')
}

async function handleSave() {
  await formRef.value?.validate(async (valid) => {
    if (!valid) return
    saving.value = true
    try {
      if (editingId.value) {
        const data: Record<string, unknown> = { role: form.role }
        if (form.password) data.password = form.password
        await adminStore.updateUser(editingId.value, data)
      } else {
        await adminStore.createUser({ email: form.email, password: form.password, role: form.role })
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
  await ElMessageBox.confirm('确认删除该用户？', '删除确认', { type: 'warning' })
  await adminStore.deleteUser(id)
  ElMessage.success('已删除')
}

onMounted(async () => {
  loading.value = true
  await adminStore.fetchUsers().finally(() => { loading.value = false })
})
</script>
