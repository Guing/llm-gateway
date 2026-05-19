<template>
  <div class="flex h-screen bg-gray-100 overflow-hidden">
    <!-- Mobile overlay -->
    <Transition name="fade">
      <div
        v-if="sidebarOpen"
        class="fixed inset-0 bg-black/50 z-20 lg:hidden"
        @click="sidebarOpen = false"
      />
    </Transition>

    <!-- Sidebar -->
    <aside
      :class="[
        'fixed lg:static inset-y-0 left-0 z-30 w-56 bg-gray-900 text-white flex flex-col transition-transform duration-300 ease-in-out shrink-0',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
      ]"
    >
      <div class="px-6 py-5 border-b border-gray-700 flex items-center justify-between">
        <div class="min-w-0">
          <h1 class="text-lg font-bold text-white">LLM Gateway</h1>
          <p class="text-xs text-gray-400 mt-0.5">管理控制台</p>
        </div>
        <button
          class="lg:hidden text-gray-400 hover:text-white p-1 ml-2 shrink-0"
          @click="sidebarOpen = false"
        >
          <el-icon size="18"><Close /></el-icon>
        </button>
      </div>

      <nav class="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
          active-class="bg-blue-600 text-white hover:bg-blue-700"
          @click="sidebarOpen = false"
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

    <!-- Main content area -->
    <div class="flex-1 flex flex-col min-w-0 overflow-hidden">
      <!-- Mobile top bar -->
      <header class="lg:hidden bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 shrink-0 z-10">
        <button
          class="p-1 rounded text-gray-600 hover:bg-gray-100 active:bg-gray-200 touch-manipulation"
          @click="sidebarOpen = true"
        >
          <el-icon size="22"><Expand /></el-icon>
        </button>
        <span class="font-semibold text-gray-800 flex-1 truncate">LLM Gateway</span>
        <span class="text-xs text-gray-400 truncate max-w-[130px]">{{ user?.email }}</span>
      </header>

      <!-- Page content -->
      <main class="flex-1 overflow-y-auto overflow-x-hidden">
        <router-view />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { Close, Expand } from '@element-plus/icons-vue'

const auth = useAuthStore()
const router = useRouter()
const user = computed(() => auth.user)
const sidebarOpen = ref(false)

const allNavItems = [
  { path: '/dashboard', label: '仪表盘', icon: 'Odometer', adminOnly: false },
  { path: '/analytics', label: '数据分析', icon: 'TrendCharts', adminOnly: true },
  { path: '/channels', label: '上游渠道', icon: 'Connection', adminOnly: true },
  { path: '/priorities', label: '模型优先级', icon: 'Sort', adminOnly: true },
  { path: '/users', label: '用户管理', icon: 'User', adminOnly: true },
  { path: '/api-keys', label: 'API Keys', icon: 'Key', adminOnly: false },
  { path: '/logs', label: '聊天记录', icon: 'Document', adminOnly: false },
  { path: '/system-logs', label: '系统日志', icon: 'List', adminOnly: true },
]

const navItems = computed(() =>
  allNavItems.filter((item) => !item.adminOnly || auth.isAdmin)
)

function handleLogout() {
  auth.logout()
  router.push('/login')
}
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
