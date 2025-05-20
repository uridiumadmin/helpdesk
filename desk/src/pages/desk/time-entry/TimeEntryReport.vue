<template>
  <div class="flex flex-col">
    <LayoutHeader>
      <template #left-header>
        <div class="text-lg font-medium text-gray-900">Time Entries</div>
      </template>
    </LayoutHeader>
    <ListViewBuilder :options="options" />
  </div>
</template>

<script setup lang="ts">
import { LayoutHeader, ListViewBuilder } from "@/components";
import { computed } from "vue";

const options = computed(() => {
  return {
    doctype: "HD Time Entry",
    filters: {},
  };
});
</script>
