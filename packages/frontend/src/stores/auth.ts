import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import client from '@/api/client'

interface User {
  id: number
  email: string
  role: string
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem('token'))
  const user = ref<User | null>(
    JSON.parse(localStorage.getItem('user') || 'null')
  )

  const isLoggedIn = computed(() => !!token.value)
  const isAdmin = computed(() => user.value?.role === 'admin')

  function setAuth(newToken: string, newUser: User) {
    token.value = newToken
    user.value = newUser
    localStorage.setItem('token', newToken)
    localStorage.setItem('user', JSON.stringify(newUser))
  }

  function logout() {
    token.value = null
    user.value = null
    localStorage.removeItem('token')
    localStorage.removeItem('user')
  }

  async function login(email: string, password: string) {
    const res = await client.post('/auth/login', { email, password })
    setAuth(res.data.token, res.data.user)
    return res.data
  }

  async function register(email: string, password: string) {
    const res = await client.post('/auth/register', { email, password })
    setAuth(res.data.token, res.data.user)
    return res.data
  }

  return { token, user, isLoggedIn, isAdmin, login, register, logout, setAuth }
})
