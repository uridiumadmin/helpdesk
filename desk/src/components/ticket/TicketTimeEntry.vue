<template>
  <div class="space-y-3 p-4">
    <div
      v-for="entry in entries"
      :key="entry.name"
      class="flex flex-col text-base"
    >
      <div class="mb-1 ml-0.5 flex items-center justify-between">
        <div class="flex items-center gap-2 text-gray-600">
          <Avatar
            size="sm"
            :label="getUser(entry.owner).full_name"
            :image="getUser(entry.owner).user_image"
          />
          <p>
            <span class="font-medium text-gray-800">
              {{ getUser(entry.owner).full_name }}
            </span>
            <span> logged </span>
            <span class="font-medium text-gray-800">{{ entry.hours }}h</span>
          </p>
        </div>
        <Tooltip :text="dateFormat(entry.creation, dateTooltipFormat)">
          <span class="pl-0.5 text-sm text-gray-600">
            {{ timeAgo(entry.creation) }}
          </span>
        </Tooltip>
      </div>
      <div class="rounded bg-gray-50 px-4 py-3">
        <div class="text-sm text-gray-600">
          {{ entry.description }}
        </div>
        <div class="text-sm text-gray-600">
          {{ entry.from_time }} - {{ entry.to_time }}
        </div>
      </div>
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
import { ref } from "vue";
import { Button, Avatar, Tooltip } from "frappe-ui";
import TimeEntryModal from "./TimeEntryModal.vue";
import { dateFormat, timeAgo, dateTooltipFormat } from "@/utils";
import { useUserStore } from "@/stores/user";

interface Props {
  entries: any[];
  ticketId: string;
}

const props = defineProps<Props>();
const emit = defineEmits(["update"]);
const { getUser } = useUserStore();

const showModal = ref(false);

function emitUpdate(e: any[]) {
  emit("update", e);
}
</script>
