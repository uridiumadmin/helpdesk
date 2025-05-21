<template>
  <div class="flex flex-1 flex-col text-base">
    <div class="mb-1 ml-0.5 flex items-center justify-between">
      <div class="flex items-center gap-2 text-gray-600">
        <Avatar
          size="sm"
          :label="getUser(owner).full_name"
          :image="getUser(owner).user_image"
        />
        <p>
          <span class="font-medium text-gray-800">{{ getUser(owner).full_name }}</span>
          <span> logged </span>
          <span class="font-medium text-gray-800">{{ hours }}h</span>
        </p>
      </div>
      <Tooltip :text="dateFormat(creation, dateTooltipFormat)">
        <span class="pl-0.5 text-sm text-gray-600">{{ timeAgo(creation) }}</span>
      </Tooltip>
    </div>
    <div class="rounded bg-gray-50 px-4 py-3">
      <div class="text-sm text-gray-600">{{ description }}</div>
      <div class="text-sm text-gray-600">{{ from_time }} - {{ to_time }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { TimeEntryActivity } from "@/types";
import { PropType } from "vue";
import { Avatar, Tooltip } from "frappe-ui";
import { dateFormat, timeAgo, dateTooltipFormat } from "@/utils";
import { useUserStore } from "@/stores/user";

const props = defineProps({
  activity: {
    type: Object as PropType<TimeEntryActivity>,
    required: true,
  },
});

const { owner, hours, description, from_time, to_time, creation } = props.activity;

const { getUser } = useUserStore();
</script>
