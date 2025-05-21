<template>
  <div class="flex flex-col gap-2 border-t p-4">
    <div class="flex items-center justify-between">
      <span class="text-sm font-medium text-gray-700">{{ formatted }}</span>
      <Button size="sm" :label="running ? 'Stop' : 'Start'" @click="toggle" />
    </div>
    <Button
      size="sm"
      class="w-full"
      label="Save"
      variant="solid"
      :disabled="!hasDuration"
      @click="openModal"
    />
    <TimeEntryModal
      v-model="showModal"
      :ticket-id="ticketId"
      :default-from-time="fromTime"
      :default-to-time="toTime"
      :default-hours="hours"
      @update="(e) => emit('update', e)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { Button } from 'frappe-ui';
import TimeEntryModal from './TimeEntryModal.vue';
import { dayjs } from '@/dayjs';

interface Props {
  ticketId: string;
}

const props = defineProps<Props>();
const emit = defineEmits(['update']);

const running = ref(false);
const start = ref<any>(null);
const end = ref<any>(null);
let interval: any = null;
const elapsed = ref(0);
const showModal = ref(false);

function toggle() {
  if (!running.value) {
    running.value = true;
    start.value = dayjs();
    elapsed.value = 0;
    interval = setInterval(() => {
      elapsed.value = dayjs().diff(start.value, 'second');
    }, 1000);
  } else {
    running.value = false;
    end.value = dayjs();
    clearInterval(interval);
    elapsed.value = end.value.diff(start.value, 'second');
  }
}

function openModal() {
  if (running.value) {
    toggle();
  }
  if (!start.value) return;
  showModal.value = true;
}

const formatted = computed(() => {
  const h = Math.floor(elapsed.value / 3600)
    .toString()
    .padStart(2, '0');
  const m = Math.floor((elapsed.value % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const s = Math.floor(elapsed.value % 60)
    .toString()
    .padStart(2, '0');
  return `${h}:${m}:${s}`;
});

const hasDuration = computed(() => elapsed.value > 0);

const hours = computed(() => {
  return elapsed.value ? parseFloat((elapsed.value / 3600).toFixed(2)) : null;
});

const fromTime = computed(() => (start.value ? start.value.format() : null));
const toTime = computed(() => {
  if (running.value) {
    return dayjs().format();
  }
  return end.value ? end.value.format() : null;
});
</script>

<style scoped></style>
