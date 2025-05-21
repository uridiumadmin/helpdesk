<template>
  <div class="p-4 space-y-2">
    <div
      v-for="entry in entries"
      :key="entry.name"
      class="border rounded p-2"
    >
      <div class="text-sm">
        {{ entry.from_time }} - {{ entry.to_time }} ({{ entry.hours }}h)
      </div>
      <div class="text-gray-600 text-sm">{{ entry.description }}</div>
    </div>
    <Button class="mt-4" label="Add Time Entry" @click="showModal = true" />
    <TimeEntryModal
      v-model="showModal"
      :ticket-id="ticketId"
      @update="(e) => emitUpdate(e)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Button } from 'frappe-ui';
import TimeEntryModal from './TimeEntryModal.vue';

interface Props {
  entries: any[];
  ticketId: string;
}

const props = defineProps<Props>();
const emit = defineEmits(['update']);

const showModal = ref(false);

function emitUpdate(e: any[]) {
  emit('update', e);
}
</script>
