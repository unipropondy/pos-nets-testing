import axios from 'axios';
import { API_URL, onServerUrlChange } from '@/constants/Config';
import { useAuthStore } from './stores/authStore';

const API = axios.create({
  baseURL: `${API_URL}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Dynamically update baseURL when user changes server IP/router config
onServerUrlChange((newUrl) => {
  API.defaults.baseURL = `${newUrl}/api`;
  console.log(`🔄 [API Client] Updated Axios baseURL to: ${API.defaults.baseURL}`);
});

// Automatically attach the JWT token to every outgoing request
API.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export default API;