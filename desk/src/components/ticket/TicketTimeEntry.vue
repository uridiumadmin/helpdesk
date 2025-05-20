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
    <Button class="mt-4" label="Add Time Entry" @click="$emit('add')" />
  </div>
</template>

<script setup lang="ts">
import { Button } from "frappe-ui";

defineProps<{ entries: any[] }>();

defineEmits(["add"]);
</script>
