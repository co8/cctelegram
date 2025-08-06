<template>
  <div class="version-selector">
    <div class="dropdown">
      <button 
        class="dropdown-trigger"
        @click="toggleDropdown"
        :class="{ active: isOpen }"
      >
        <span class="version-label">{{ currentVersion.label }}</span>
        <span class="version-status" :class="`status-${currentVersion.status}`">
          {{ currentVersion.status.toUpperCase() }}
        </span>
        <svg class="dropdown-icon" :class="{ rotated: isOpen }" viewBox="0 0 24 24">
          <path d="M7 10l5 5 5-5z"/>
        </svg>
      </button>
      
      <div v-if="isOpen" class="dropdown-menu">
        <div class="dropdown-section">
          <h4>Stable Releases</h4>
          <a 
            v-for="version in stableVersions"
            :key="version.version"
            :href="version.path"
            class="dropdown-item"
            :class="{ active: version.version === currentVersion.version }"
          >
            <div class="version-info">
              <span class="version-number">{{ version.version }}</span>
              <span v-if="version.isLatest" class="latest-badge">LATEST</span>
            </div>
            <span class="release-date">{{ formatDate(version.releaseDate) }}</span>
          </a>
        </div>
        
        <div v-if="preReleases.length" class="dropdown-section">
          <h4>Pre-releases</h4>
          <a 
            v-for="version in preReleases"
            :key="version.version"
            :href="version.path"
            class="dropdown-item"
            :class="{ active: version.version === currentVersion.version }"
          >
            <div class="version-info">
              <span class="version-number">{{ version.version }}</span>
              <span class="status-badge" :class="`status-${version.status}`">
                {{ version.status.toUpperCase() }}
              </span>
            </div>
            <span class="release-date">{{ formatDate(version.releaseDate) }}</span>
          </a>
        </div>
        
        <div v-if="archivedVersions.length" class="dropdown-section">
          <h4>Archived Versions</h4>
          <a 
            v-for="version in archivedVersions"
            :key="version.version"
            :href="version.path"
            class="dropdown-item archived"
            :class="{ active: version.version === currentVersion.version }"
          >
            <div class="version-info">
              <span class="version-number">{{ version.version }}</span>
              <span class="archived-badge">ARCHIVED</span>
            </div>
            <span class="release-date">{{ formatDate(version.releaseDate) }}</span>
          </a>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vitepress'

const route = useRoute()
const isOpen = ref(false)
const versions = ref({})

// Load versions data
onMounted(async () => {
  try {
    const response = await fetch('/docs/versions.json')
    versions.value = await response.json()
  } catch (error) {
    console.error('Failed to load versions:', error)
    // Fallback versions
    versions.value = {
      versions: [
        {
          version: "v1.7.0",
          label: "v1.7.0 (Latest)",
          path: "/docs/",
          isLatest: true,
          releaseDate: "2024-12-20",
          status: "stable"
        }
      ],
      preReleases: [],
      defaultVersion: "v1.7.0"
    }
  }
})

const currentVersion = computed(() => {
  const allVersions = [...(versions.value.versions || []), ...(versions.value.preReleases || [])]
  const path = route.path
  
  // Find version based on current path
  const version = allVersions.find(v => 
    path.startsWith(v.path) || (v.isLatest && path.startsWith('/docs/'))
  )
  
  return version || allVersions[0] || { 
    version: "v1.7.0", 
    label: "v1.7.0", 
    status: "stable",
    releaseDate: "2024-12-20"
  }
})

const stableVersions = computed(() => 
  (versions.value.versions || []).filter(v => v.status === 'stable')
)

const preReleases = computed(() => 
  versions.value.preReleases || []
)

const archivedVersions = computed(() => 
  (versions.value.versions || []).filter(v => v.status === 'archived')
)

const toggleDropdown = () => {
  isOpen.value = !isOpen.value
}

const formatDate = (dateStr) => {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

// Close dropdown when clicking outside
const handleClickOutside = (event) => {
  if (!event.target.closest('.version-selector')) {
    isOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
.version-selector {
  position: relative;
  display: inline-block;
}

.dropdown-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 160px;
  justify-content: space-between;
}

.dropdown-trigger:hover,
.dropdown-trigger.active {
  background: var(--vp-c-bg-elv);
  border-color: var(--vp-c-brand);
}

.version-label {
  font-weight: 500;
  color: var(--vp-c-text-1);
}

.version-status {
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
}

.status-stable {
  background: var(--vp-c-green-soft);
  color: var(--vp-c-green-dark);
}

.status-beta {
  background: var(--vp-c-yellow-soft);
  color: var(--vp-c-yellow-dark);
}

.status-alpha {
  background: var(--vp-c-red-soft);
  color: var(--vp-c-red-dark);
}

.status-archived {
  background: var(--vp-c-gray-soft);
  color: var(--vp-c-gray-dark);
}

.dropdown-icon {
  width: 16px;
  height: 16px;
  fill: var(--vp-c-text-2);
  transition: transform 0.2s ease;
}

.dropdown-icon.rotated {
  transform: rotate(180deg);
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  border-radius: 6px;
  box-shadow: var(--vp-shadow-3);
  z-index: 1000;
  max-height: 400px;
  overflow-y: auto;
}

.dropdown-section {
  padding: 8px 0;
}

.dropdown-section:not(:last-child) {
  border-bottom: 1px solid var(--vp-c-divider);
}

.dropdown-section h4 {
  padding: 8px 16px 4px;
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--vp-c-text-2);
}

.dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  color: var(--vp-c-text-1);
  text-decoration: none;
  transition: background-color 0.2s ease;
}

.dropdown-item:hover {
  background: var(--vp-c-bg-elv);
}

.dropdown-item.active {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-dark);
}

.dropdown-item.archived {
  opacity: 0.7;
}

.version-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.version-number {
  font-weight: 500;
}

.latest-badge,
.status-badge,
.archived-badge {
  padding: 1px 4px;
  border-radius: 2px;
  font-size: 9px;
  font-weight: 600;
}

.latest-badge {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-dark);
}

.archived-badge {
  background: var(--vp-c-gray-soft);
  color: var(--vp-c-gray-dark);
}

.release-date {
  font-size: 12px;
  color: var(--vp-c-text-2);
}
</style>