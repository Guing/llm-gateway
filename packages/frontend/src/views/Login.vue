<template>
  <div class="min-h-screen bg-gray-50 flex items-center justify-center p-4">
    <el-card class="w-full max-w-md shadow-lg">
      <template #header>
        <div class="text-center">
          <h1 class="text-2xl font-bold text-gray-800">LLM Gateway</h1>
          <p class="text-sm text-gray-500 mt-1">登录管理控制台</p>
        </div>
      </template>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        @submit.prevent="handleLogin"
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
            placeholder="输入密码"
            prefix-icon="Lock"
            size="large"
            show-password
            @keyup.enter="handleLogin"
          />
        </el-form-item>

        <el-alert v-if="error" :title="error" type="error" show-icon class="mb-4" />

        <el-button
          type="primary"
          size="large"
          class="w-full"
          :loading="loading"
          @click="handleLogin"
        >
          登录
        </el-button>

        <div class="text-center mt-4 text-sm text-gray-500">
          还没有账号？
          <router-link to="/register" class="text-blue-600 hover:underline">立即注册</router-link>
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
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

async function handleLogin() {
  await formRef.value?.validate(async (valid) => {
    if (!valid) return
    loading.value = true
    error.value = ''
    try {
      await auth.login(form.email, form.password)
      router.push('/dashboard')
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } }
      error.value = e.response?.data?.error ?? '登录失败，请重试'
    } finally {
      loading.value = false
    }
  })
}
</script>
