<template>
  <div class="flex h-screen bg-gray-100">
    <!-- Sidebar -->
    <aside class="w-56 bg-gray-900 text-white flex flex-col">
      <div class="px-6 py-5 border-b border-gray-700">
        <h1 class="text-lg font-bold text-white">LLM Gateway</h1>
        <p class="text-xs text-gray-400 mt-0.5">管理控制台</p>
      </div>

      <nav class="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
          active-class="bg-blue-600 text-white hover:bg-blue-700"
        >
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </router-link>
      </nav>

      <div class="px-4 py-4 border-t border-gray-700">
        <div class="text-xs text-gray-400 mb-2 truncate">{{ user?.email }}</div>
        <el-button size="small" type="danger" plain @click="handleLogout" class="w-full">
          退出登录
        </el-button>
      </div>
    </aside>

    <!-- Main content -->
    <main class="flex-1 overflow-y-auto">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const user = computed(() => auth.user)

const allNavItems = [
  { path: '/dashboard', label: '仪表盘', icon: 'Odometer', adminOnly: false },
  { path: '/channels', label: '上游渠道', icon: 'Connection', adminOnly: true },
  { path: '/priorities', label: '模型优先级', icon: 'Sort', adminOnly: true },
  { path: '/users', label: '用户管理', icon: 'User', adminOnly: true },
  { path: '/api-keys', label: 'API Keys', icon: 'Key', adminOnly: false },
  { path: '/logs', label: '聊天记录', icon: 'Document', adminOnly: false },
]

const navItems = computed(() =>
  allNavItems.filter((item) => !item.adminOnly || auth.isAdmin)
)

function handleLogout() {
  auth.logout()
  router.push('/login')
}
</script>
