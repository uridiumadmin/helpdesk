import frappe
from frappe import _
from frappe.model.document import Document


class HDEpic(Document):
    def validate(self):
        if self.project and not frappe.db.exists("HD Project", self.project):
            frappe.throw(_("Project {0} not found").format(self.project))
        if self.end_date and self.start_date and self.end_date < self.start_date:
            frappe.throw(_("End Date cannot be earlier than Start Date"))
