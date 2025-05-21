import frappe
from frappe import _
from frappe.model.document import Document


class HDTask(Document):
    def validate(self):
        if self.epic and not frappe.db.exists("HD Epic", self.epic):
            frappe.throw(_("Epic {0} not found").format(self.epic))
        if self.end_date and self.start_date and self.end_date < self.start_date:
            frappe.throw(_("End Date cannot be earlier than Start Date"))
