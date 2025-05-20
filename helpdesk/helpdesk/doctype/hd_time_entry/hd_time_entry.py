import frappe
from frappe.model.document import Document
from helpdesk.helpdesk.doctype.hd_ticket_activity.hd_ticket_activity import log_ticket_activity


class HDTimeEntry(Document):
    def after_insert(self):
        if self.reference_ticket:
            log_ticket_activity(self.reference_ticket, f"added time entry ({self.hours}h)")
