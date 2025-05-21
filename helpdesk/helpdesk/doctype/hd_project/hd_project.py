import frappe
from frappe import _
from frappe.model.document import Document


class HDProject(Document):
    def validate(self):
        if self.end_date and self.start_date and self.end_date < self.start_date:
            frappe.throw(_("End Date cannot be earlier than Start Date"))

