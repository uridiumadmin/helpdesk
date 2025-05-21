import frappe
from frappe.model.document import Document


class HDProjectActivity(Document):
    pass


def log_project_activity(project, action, user=None):
    doc = {"doctype": "HD Project Activity", "project": project, "action": action}
    if user:
        doc["user"] = user
    return frappe.get_doc(doc).insert(ignore_permissions=True)
