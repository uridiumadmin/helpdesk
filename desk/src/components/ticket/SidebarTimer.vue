<template>
  <div class="flex items-center justify-between gap-2 border-t p-4">
    <span class="font-mono text-sm">{{ formattedDuration }}</span>
    <div class="flex items-center gap-1">
      <Button
        v-if="timerState === 'idle' || timerState === 'paused'"
        variant="ghost"
        @click="start"
      >
        <template #icon>
          <IconPlay class="h-4 w-4" />
        </template>
      </Button>
      <template v-else>
        <Button variant="ghost" @click="pause">
          <template #icon>
            <IconPause class="h-4 w-4" />
          </template>
        </Button>
        <Button variant="ghost" @click="stop">
          <template #icon>
            <IconStop class="h-4 w-4" />
          </template>
        </Button>
      </template>
      <Button variant="ghost" :disabled="duration === 0" @click="save">
        <template #icon>
          <IconSave class="h-4 w-4" />
        </template>
      </Button>
    </div>
    <TimeEntryModal
      v-model="showModal"
      :ticket-id="ticketId"
      :initial-hours="Number((duration / 3600).toFixed(2))"
      @update="(e) => emit('update', e)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from "vue";
import { Button } from "frappe-ui";
import IconPlay from "~icons/lucide/play";
import IconPause from "~icons/lucide/pause";
import IconStop from "~icons/lucide/stop-circle";
import IconSave from "~icons/lucide/save";
import TimeEntryModal from "./TimeEntryModal.vue";
import { formatTime } from "@/utils";

interface Props {
  ticketId: string;
}
const props = defineProps<Props>();
const emit = defineEmits(["update"]);

const timerState = ref<"idle" | "running" | "paused">("idle");
const duration = ref(0);
let intervalId: number | null = null;

const showModal = ref(false);

watch(timerState, (state) => {
  if (state === "running") {
    intervalId = window.setInterval(() => {
      duration.value++;
    }, 1000);
  } else if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
});

function start() {
  if (timerState.value !== "running") {
    timerState.value = "running";
  }
}

function pause() {
  if (timerState.value === "running") {
    timerState.value = "paused";
  }
}

function stop() {
  timerState.value = "idle";
}

function save() {
  stop();
  showModal.value = true;
}

const formattedDuration = computed(() => formatTime(duration.value));

watch(showModal, (val) => {
  if (!val && timerState.value === "idle") {
    duration.value = 0;
  }
});

onUnmounted(() => {
  if (intervalId !== null) {
    clearInterval(intervalId);
  }
});
</script>

<style scoped></style>
