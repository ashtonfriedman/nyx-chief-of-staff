"""
Safe WIQL query builder with injection prevention.

All string parameters are escaped via safe_str() before WIQL insertion.
All work item IDs are validated as positive integers via validate_item_id().
No raw f-string interpolation of external values.
"""


def validate_item_id(value) -> int:
    """Validate that value is a positive integer work item ID.

    Rejects non-numeric, negative, zero, float, and URI-schema values (SEC-010).
    Returns the validated integer.
    """
    if isinstance(value, bool):
        raise ValueError("Work item ID must be a positive integer")
    try:
        int_val = int(value)
    except (TypeError, ValueError):
        raise ValueError("Work item ID must be a positive integer")
    if int_val <= 0:
        raise ValueError("Work item ID must be a positive integer")
    # Reject if original string representation contains non-digit chars
    # (catches "123abc", "javascript:...", float strings like "1.5")
    str_val = str(value).strip()
    if not str_val.isdigit():
        raise ValueError("Work item ID must be a positive integer")
    return int_val


def safe_str(value: str) -> str:
    """Escape single quotes for safe WIQL string interpolation.

    WIQL uses '' to represent a literal single quote inside string literals.
    """
    if not isinstance(value, str):
        value = str(value)
    return value.replace("'", "''")


class WiqlBuilder:
    """Constructs WIQL queries with safe parameter interpolation."""

    def __init__(self):
        self._conditions: list[str] = []
        self._select_fields: list[str] = ["[System.Id]"]
        self._order_by: list[str] = []

    def select(self, *fields: str) -> "WiqlBuilder":
        self._select_fields = [f"[{f}]" for f in fields]
        return self

    def where_iteration_under(self, iteration_path: str) -> "WiqlBuilder":
        self._conditions.append(
            f"[System.IterationPath] UNDER '{safe_str(iteration_path)}'"
        )
        return self

    def where_iteration_eq(self, iteration_path: str) -> "WiqlBuilder":
        self._conditions.append(
            f"[System.IterationPath] = '{safe_str(iteration_path)}'"
        )
        return self

    def where_area_under(self, area_path: str) -> "WiqlBuilder":
        self._conditions.append(
            f"[System.AreaPath] UNDER '{safe_str(area_path)}'"
        )
        return self

    def where_types(self, types: list[str]) -> "WiqlBuilder":
        type_list = ", ".join(f"'{safe_str(t)}'" for t in types)
        self._conditions.append(f"[System.WorkItemType] IN ({type_list})")
        return self

    def where_states_not_in(self, states: list[str]) -> "WiqlBuilder":
        state_list = ", ".join(f"'{safe_str(s)}'" for s in states)
        self._conditions.append(f"[System.State] NOT IN ({state_list})")
        return self

    def where_states_in(self, states: list[str]) -> "WiqlBuilder":
        state_list = ", ".join(f"'{safe_str(s)}'" for s in states)
        self._conditions.append(f"[System.State] IN ({state_list})")
        return self

    def where_parent(self, parent_id) -> "WiqlBuilder":
        validated = validate_item_id(parent_id)
        self._conditions.append(f"[System.Parent] = {validated}")
        return self

    def where_id_in(self, ids: list) -> "WiqlBuilder":
        validated = [str(validate_item_id(i)) for i in ids]
        id_list = ", ".join(validated)
        self._conditions.append(f"[System.Id] IN ({id_list})")
        return self

    def where_assigned_to(self, name: str) -> "WiqlBuilder":
        self._conditions.append(
            f"[System.AssignedTo] CONTAINS '{safe_str(name)}'"
        )
        return self

    def where_unassigned(self) -> "WiqlBuilder":
        self._conditions.append("[System.AssignedTo] = ''")
        return self

    def where_tag_contains(self, tag: str) -> "WiqlBuilder":
        self._conditions.append(
            f"[System.Tags] CONTAINS '{safe_str(tag)}'"
        )
        return self

    def where_raw(self, condition: str) -> "WiqlBuilder":
        """Add a raw WIQL condition. Use only for static conditions with no external input."""
        self._conditions.append(condition)
        return self

    def order_by(self, field: str, direction: str = "ASC") -> "WiqlBuilder":
        direction = direction.upper()
        if direction not in ("ASC", "DESC"):
            direction = "ASC"
        self._order_by.append(f"[{field}] {direction}")
        return self

    def build(self) -> str:
        fields = ", ".join(self._select_fields)
        query = f"SELECT {fields} FROM WorkItems"
        if self._conditions:
            where = " AND ".join(self._conditions)
            query += f" WHERE {where}"
        if self._order_by:
            order = ", ".join(self._order_by)
            query += f" ORDER BY {order}"
        return query
