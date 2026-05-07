<template>
  <div class="min-h-screen bg-gray-50 flex items-center justify-center p-4">
    <el-card class="w-full max-w-md shadow-lg">
      <template #header>
        <div class="text-center">
          <h1 class="text-2xl font-bold text-gray-800">注册账号</h1>
          <p class="text-sm text-gray-500 mt-1">创建 LLM Gateway 账号</p>
        </div>
      </template>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        @submit.prevent="handleRegister"
      >
        <el-form-item label="邮箱" prop="email">
          <el-input
            v-model="form.email"
            type="email"
            placeholder="your@email.com"
            prefix-icon="Message"
            size="large"
          />
        </el-form-item>

        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="至少 6 位密码"
            prefix-icon="Lock"
            size="large"
            show-password
          />
        </el-form-item>

        <el-alert v-if="error" :title="error" type="error" show-icon class="mb-4" />

        <el-button
          type="primary"
          size="large"
          class="w-full"
          :loading="loading"
          @click="handleRegister"
        >
          注册
        </el-button>

        <div class="text-center mt-4 text-sm text-gray-500">
          已有账号？
          <router-link to="/login" class="text-blue-600 hover:underline">立即登录</router-link>
        </div>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import type { FormInstance } from 'element-plus'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()

const formRef = ref<FormInstance>()
const loading = ref(false)
const error = ref('')
const form = reactive({ email: '', password: '' })

const rules = {
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email' as const, message: '请输入有效的邮箱', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码至少 6 位', trigger: 'blur' },
  ],
}

async function handleRegister() {
  await formRef.value?.validate(async (valid) => {
    if (!valid) return
    loading.value = true
    error.value = ''
    try {
      await auth.register(form.email, form.password)
      router.push('/dashboard')
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } }
      error.value = e.response?.data?.error ?? '注册失败，请重试'
    } finally {
      loading.value = false
    }
  })
}
</script>
