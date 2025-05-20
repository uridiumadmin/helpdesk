import { createResource } from "frappe-ui";

export const newTimeEntry = createResource({
  url: "helpdesk.helpdesk.doctype.hd_ticket.api.new_time_entry",
});

export const getTimeEntries = createResource({
  url: "helpdesk.helpdesk.doctype.hd_ticket.api.get_time_entries",
  cache: ({ ticket }) => ["time-entries", ticket],
});

export const updateTimeEntry = createResource({
  url: "frappe.client.set_value",
});

export const deleteTimeEntry = createResource({
  url: "frappe.client.delete",
});
