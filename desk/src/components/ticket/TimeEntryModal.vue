<template>
  <Dialog v-model="showDialog" :options="{ title: 'Add Time Entry' }">
    <template #body-content>
      <div class="flex flex-col gap-4">
        <DateTimePicker
          v-model="form.from_time"
          label="From Time"
          class="form-control"
          :options="{ enableTime: true, dateFormat: 'Y-m-d H:i:S' }"
        />
        <DateTimePicker
          v-model="form.to_time"
          label="To Time"
          class="form-control"
          :options="{ enableTime: true, dateFormat: 'Y-m-d H:i:S' }"
        />
        <FormControl
          v-model="form.hours"
          type="number"
          label="Hours"
          class="form-control"
        />
        <FormControl
          v-model="form.description"
          type="textarea"
          label="Description"
          class="form-control"
        />
        <FormControl
          v-model="form.billable"
          type="checkbox"
          label="Billable"
          class="form-control"
        />
        <FormControl
          v-if="!form.billable"
          v-model="form.show_on_invoice"
          type="checkbox"
          label="Show on Invoice"
          class="form-control"
        />
      </div>
    </template>
    <template #actions>
      <Button
        class="w-full"
        variant="solid"
        label="Add"
        :loading="newTimeEntry.loading"
        @click="handleSubmit"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">

import { reactive, watch } from 'vue';
import { Dialog, Button, FormControl, DateTimePicker } from 'frappe-ui';
import { createToast } from '@/utils';
import { newTimeEntry, getTimeEntries } from '@/stores/timeEntry';
import { dayjs } from '@/dayjs';
import { useError } from '@/composables/error';

interface Props {
  ticketId: string;
  defaultFromTime?: string | null;
  defaultToTime?: string | null;
  defaultHours?: number | null;

}

const props = withDefaults(defineProps<Props>(), {
  defaultFromTime: null,
  defaultToTime: null,
  defaultHours: null,
});
const showDialog = defineModel<boolean>();
const emit = defineEmits(["update"]);
const showError = useError();

const form = reactive({
  from_time: null as string | null,
  to_time: null as string | null,
  hours: null as number | null,
  description: "",
  billable: true,
  show_on_invoice: true,
});


watch(
  () => showDialog.value,
  (val) => {
    if (val) {
      form.from_time = props.defaultFromTime;
      form.to_time = props.defaultToTime;
      form.hours = props.defaultHours;
    }
  }
);


async function handleSubmit() {
  try {
    await newTimeEntry.submit(
      {
        reference_ticket: props.ticketId,
        from_time: form.from_time
          ? dayjs(form.from_time).format('YYYY-MM-DD HH:mm:ss')
          : null,
        to_time: form.to_time
          ? dayjs(form.to_time).format('YYYY-MM-DD HH:mm:ss')
          : null,
        hours: form.hours,
        description: form.description,
        billable: form.billable ? 1 : 0,
        show_on_invoice: form.show_on_invoice ? 1 : 0,
      },
      {
        validate: (params) => {
          if (!params.from_time) return "From Time is required";
          if (!params.to_time) return "To Time is required";
          if (!params.hours) return "Hours is required";
        },
        onSuccess: async () => {
          createToast({
            title: "Time entry added",
            icon: "check",
            iconClasses: "text-green-600",
          });
          const res = await getTimeEntries.update({
            params: { ticket: props.ticketId },
          });
          emit("update", res);
          showDialog.value = false;
          form.from_time = null;
          form.to_time = null;
          form.hours = null;
          form.description = "";
          form.billable = true;
          form.show_on_invoice = true;
        },
      },
    );
  } catch (e) {
    showError(e as any);
  }
}
</script>

<style scoped></style>
