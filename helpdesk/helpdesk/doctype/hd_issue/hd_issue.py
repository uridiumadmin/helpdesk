import frappe
from frappe import _
from frappe.model.document import Document


class HDIssue(Document):
    def validate(self):
        if self.task and not frappe.db.exists("HD Task", self.task):
            frappe.throw(_("Task {0} not found").format(self.task))
        if self.end_date and self.start_date and self.end_date < self.start_date:
            frappe.throw(_("End Date cannot be earlier than Start Date"))
