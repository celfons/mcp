// GERADO por scripts/gen-evo-catalog.mjs a partir do swagger da EVO
// (EVO API v1). Não edite à mão: rode o script.
//
// Rotas GET fora do catálogo, de propósito:
//   - /api/v2/accessControl/facial-photo — foto do reconhecimento facial
//   - /api/v2/configuration/gateway — configuração (credenciais) do gateway de pagamento
//   - /api/v1/configuration/gateway-form-token — token do gateway de pagamento
//   - /api/v1/members/{idMember}/creditcard — cartões de crédito do aluno
//   - /api/v1/members/resetPassword — link de troca de senha do aluno
//   - /api/v1/pix/qr-code — gera cobrança PIX (efeito colateral, apesar do GET)

export type EvoParam = {
  name: string;
  in: "query" | "path";
  required: boolean;
  description: string;
  type: "string" | "integer" | "number" | "boolean" | "array";
  items?: "string" | "number";
  enum?: readonly (string | number)[];
  format?: "date";
};

export type EvoRoute = { tool: string; path: string; summary: string; tag: string; params: readonly EvoParam[] };

export const EVO_ROUTES: readonly EvoRoute[] = [
  {
    "tool": "evo_v1_activities",
    "path": "/api/v1/activities",
    "summary": "Get activities",
    "tag": "Activities",
    "params": [
      {
        "name": "search",
        "in": "query",
        "required": false,
        "description": "Filter by activity name, group name or tags",
        "type": "string"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Filber by membership IdBranch (Only available when using a multilocation key, ignored otherwise)",
        "type": "integer"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "Total number of records to return.",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "Total number of records to skip.",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_activities_enrollment",
    "path": "/api/v1/activities/enrollment",
    "summary": "Get activities enrollment by member or membership",
    "tag": "Activities",
    "params": [
      {
        "name": "idMember",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "idMemberMemberShip",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "date",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string",
        "format": "date"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_activities_enrollment_member_enrollment",
    "path": "/api/v1/activities/enrollment/member-enrollment",
    "summary": "Get enrollment details for a member",
    "tag": "Activities",
    "params": [
      {
        "name": "idMember",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "status",
        "in": "query",
        "required": false,
        "description": "Filter by a status. Inform a comma separated list Ex.: \"1 - Active, 2 - Inactive \"",
        "type": "string"
      }
    ]
  },
  {
    "tool": "evo_v1_activities_list_unavailable_spots",
    "path": "/api/v1/activities/list-unavailable-spots",
    "summary": "List of spots that are already filled in the activity session",
    "tag": "Activities",
    "params": [
      {
        "name": "idConfiguration",
        "in": "query",
        "required": false,
        "description": "Activity IdConfiguration",
        "type": "integer"
      },
      {
        "name": "date",
        "in": "query",
        "required": false,
        "description": "Activity schedule date (yyyy-MM-dd)",
        "type": "string",
        "format": "date"
      }
    ]
  },
  {
    "tool": "evo_v1_activities_schedule",
    "path": "/api/v1/activities/schedule",
    "summary": "Get activities schedule",
    "tag": "Activities",
    "params": [
      {
        "name": "idMember",
        "in": "query",
        "required": false,
        "description": "Filter by a member",
        "type": "integer"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "Limit the ammount of itens returned",
        "type": "integer"
      },
      {
        "name": "onlyAvailables",
        "in": "query",
        "required": false,
        "description": "Filter by activities that are available",
        "type": "boolean"
      },
      {
        "name": "date",
        "in": "query",
        "required": false,
        "description": "Filter by a specific date",
        "type": "string",
        "format": "date"
      },
      {
        "name": "showFullWeek",
        "in": "query",
        "required": false,
        "description": "Show all activities in the week (Sunday to Saturday)",
        "type": "boolean"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Filter by a different branch than the current one",
        "type": "integer"
      },
      {
        "name": "idActivities",
        "in": "query",
        "required": false,
        "description": "Filter by a activities ids. Inform a comma separated list Ex.: \"1,2,3\"",
        "type": "string"
      },
      {
        "name": "idAudiences",
        "in": "query",
        "required": false,
        "description": "Filter by a audiences ids. Inform a comma separated list Ex.: \"1,2,3\"",
        "type": "string"
      },
      {
        "name": "idBranchToken",
        "in": "query",
        "required": false,
        "description": "Filter by a different branch than the current one",
        "type": "string"
      },
      {
        "name": "origin",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "experimentalClass",
        "in": "query",
        "required": false,
        "description": "When true, returns only activity sessions that allow experimental (trial) classes",
        "type": "boolean"
      }
    ]
  },
  {
    "tool": "evo_v1_activities_schedule_by_service_or_membership",
    "path": "/api/v1/activities/schedule/by-service-or-membership",
    "summary": "Get activities schedule by idService or idMembership",
    "tag": "Activities",
    "params": [
      {
        "name": "idService",
        "in": "query",
        "required": false,
        "description": "Filter by a service (required if idMembership not informed)",
        "type": "integer"
      },
      {
        "name": "idMembership",
        "in": "query",
        "required": false,
        "description": "Filter by a membership (required if idService not informed)",
        "type": "integer"
      },
      {
        "name": "startDate",
        "in": "query",
        "required": false,
        "description": "Start date of the query (required)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "endDate",
        "in": "query",
        "required": false,
        "description": "End date of the query (optional). If not provided, defaults to startDate + 7 days. Always limited to a maximum of 7 days from the startDate.",
        "type": "string",
        "format": "date"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Optional. Filter by a branch",
        "type": "integer"
      },
      {
        "name": "idActivities",
        "in": "query",
        "required": false,
        "description": "Optional. Filter by one or more activity ids (comma separated list)",
        "type": "string"
      },
      {
        "name": "allowEnrollment",
        "in": "query",
        "required": false,
        "description": "Optional. Filter all future schedules, returning only the activities/schedules that have available slots.",
        "type": "boolean"
      }
    ]
  },
  {
    "tool": "evo_v1_activities_schedule_detail",
    "path": "/api/v1/activities/schedule/detail",
    "summary": "Get activities schedule details",
    "tag": "Activities",
    "params": [
      {
        "name": "idConfiguration",
        "in": "query",
        "required": false,
        "description": "Activity IdConfiguration (Must be use combined with activityDate)",
        "type": "integer"
      },
      {
        "name": "activityDate",
        "in": "query",
        "required": false,
        "description": "Activity schedule date (yyyy-MM-dd) (Must be use combined with idConfiguration)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "idActivitySession",
        "in": "query",
        "required": false,
        "description": "Activity idActivitySession (This is mandatory if IdConfiguration and activityDate are null)",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_appointment_activities_available",
    "path": "/api/v1/appointment/activities-available",
    "summary": "Get available activities for appointment",
    "tag": "Appointments",
    "params": [
      {
        "name": "idMember",
        "in": "query",
        "required": false,
        "description": "Id Member",
        "type": "integer"
      },
      {
        "name": "idProspect",
        "in": "query",
        "required": false,
        "description": "Id Prospect",
        "type": "integer"
      },
      {
        "name": "idEmployee",
        "in": "query",
        "required": false,
        "description": "Id Employee",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_appointment_availability",
    "path": "/api/v1/appointment/availability",
    "summary": "Get the available times for appointment",
    "tag": "Appointments",
    "params": [
      {
        "name": "idActivity",
        "in": "query",
        "required": false,
        "description": "Id Activity (required)",
        "type": "integer"
      },
      {
        "name": "activityDate",
        "in": "query",
        "required": false,
        "description": "Activity Date (required) (yyyy-MM-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Filter by membership IdBranch (Only available when using a multilocation key, ignored otherwise)",
        "type": "integer"
      },
      {
        "name": "idMember",
        "in": "query",
        "required": false,
        "description": "Id Member",
        "type": "integer"
      },
      {
        "name": "idProspect",
        "in": "query",
        "required": false,
        "description": "Id Prospect",
        "type": "integer"
      },
      {
        "name": "idEmployee",
        "in": "query",
        "required": false,
        "description": "Id Employee",
        "type": "integer"
      },
      {
        "name": "idProfessor",
        "in": "query",
        "required": false,
        "description": "Id Professor",
        "type": "integer"
      },
      {
        "name": "idArea",
        "in": "query",
        "required": false,
        "description": "Id Area",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_appointment_blocked",
    "path": "/api/v1/appointment/blocked",
    "summary": "Get blocked appointments",
    "tag": "Appointments",
    "params": [
      {
        "name": "startDate",
        "in": "query",
        "required": false,
        "description": "Start date of the query (required) (yyyy-MM-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "endDate",
        "in": "query",
        "required": false,
        "description": "End date of the query (required) (yyyy-MM-dd)",
        "type": "string",
        "format": "date"
      }
    ]
  },
  {
    "tool": "evo_v1_appointments_activities",
    "path": "/api/v1/appointments/activities",
    "summary": "Get activities",
    "tag": "Appointments",
    "params": [
      {
        "name": "search",
        "in": "query",
        "required": false,
        "description": "Filter by activity name, group name or tags",
        "type": "string"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Filter by membership IdBranch (Only available when using a multilocation key, ignored otherwise)",
        "type": "integer"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "Total number of records to return.",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "Total number of records to skip.",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_appointments_schedule_detail",
    "path": "/api/v1/appointments/schedule/detail",
    "summary": "Retrieves detailed information about scheduled appointment sessions",
    "tag": "Appointments",
    "params": [
      {
        "name": "idMember",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "idProspect",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "idEmployee",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "idActivitySession",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "startActivityDate",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string",
        "format": "date"
      },
      {
        "name": "endActivityDate",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string",
        "format": "date"
      }
    ]
  },
  {
    "tool": "evo_v1_bank_accounts",
    "path": "/api/v1/bank-accounts",
    "summary": "Get bank accounts",
    "tag": "BankAccounts",
    "params": [
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Filter by branch Id",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_carts",
    "path": "/api/v1/carts",
    "summary": "Get cart by idMember or idProspect",
    "tag": "Carts",
    "params": [
      {
        "name": "idMember",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "idProspect",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_carts_id_cart_token",
    "path": "/api/v1/carts/{idCartToken}",
    "summary": "Get cart by idCartToken",
    "tag": "Carts",
    "params": [
      {
        "name": "idCartToken",
        "in": "path",
        "required": true,
        "description": "",
        "type": "string"
      }
    ]
  },
  {
    "tool": "evo_v1_configuration",
    "path": "/api/v1/configuration",
    "summary": "Get branch configurations",
    "tag": "Configuration",
    "params": [
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_configuration_api_usage",
    "path": "/api/v1/configuration/api-usage",
    "summary": "Get API Pro usage of the current month (hits and costs by period) and the configured cost limit",
    "tag": "Configuration",
    "params": []
  },
  {
    "tool": "evo_v1_configuration_card_flags",
    "path": "/api/v1/configuration/card-flags",
    "summary": "Get card flag",
    "tag": "Configuration",
    "params": []
  },
  {
    "tool": "evo_v1_configuration_card_translation",
    "path": "/api/v1/configuration/card-translation",
    "summary": "Get card translation",
    "tag": "Configuration",
    "params": []
  },
  {
    "tool": "evo_v1_configuration_group_branches",
    "path": "/api/v1/configuration/group-branches",
    "summary": "Get group branches",
    "tag": "Configuration",
    "params": [
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Optional filter. When provided, returns only groups that contain this branch.",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_configuration_occupation",
    "path": "/api/v1/configuration/occupation",
    "summary": "Get occupation",
    "tag": "Configuration",
    "params": []
  },
  {
    "tool": "evo_v1_costcenter",
    "path": "/api/v1/costcenter",
    "summary": "Get cost center",
    "tag": "Payables",
    "params": [
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Filter by branch ID. (Only available when using a multi-location key, ignored otherwise)",
        "type": "integer"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "Total number of records to return.",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "Total number of records to skip.",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_employees_permissions",
    "path": "/api/v1/employees/permissions",
    "summary": "Retrieves employee permissions.",
    "tag": "Employees",
    "params": [
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Filter by IdBranch",
        "type": "integer"
      },
      {
        "name": "permissionName",
        "in": "query",
        "required": false,
        "description": "Filter by permission name.",
        "type": "string"
      },
      {
        "name": "status",
        "in": "query",
        "required": false,
        "description": "Filter by permission status, 0 = active, 1 = inactive.",
        "type": "integer"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_exits",
    "path": "/api/v1/exits",
    "summary": "Get exits (turnstile exits). The IdRecord sent by the \"exits\" webhook is the idExit.",
    "tag": "Exits",
    "params": [
      {
        "name": "registerDateStart",
        "in": "query",
        "required": false,
        "description": "DateTime date start",
        "type": "string",
        "format": "date"
      },
      {
        "name": "registerDateEnd",
        "in": "query",
        "required": false,
        "description": "DateTime date end",
        "type": "string",
        "format": "date"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "Total number of records to return. (Maximum of 10000)",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "Total number of records to skip.",
        "type": "integer"
      },
      {
        "name": "idExit",
        "in": "query",
        "required": false,
        "description": "ID of the exit to return (no date filter is applied when informed without dates).",
        "type": "integer"
      },
      {
        "name": "idEntry",
        "in": "query",
        "required": false,
        "description": "ID of the entry linked to the exit (no date filter is applied when informed without dates).",
        "type": "integer"
      },
      {
        "name": "idMember",
        "in": "query",
        "required": false,
        "description": "ID of the member to return",
        "type": "integer"
      },
      {
        "name": "idProspect",
        "in": "query",
        "required": false,
        "description": "ID of the prospect to return",
        "type": "integer"
      },
      {
        "name": "idEmployee",
        "in": "query",
        "required": false,
        "description": "ID of the employee to return",
        "type": "integer"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Branch Id (required when using a multilocation key, ignored otherwise)",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_management_aggregators_checkins_search",
    "path": "/api/v1/management/aggregators/checkins/search",
    "summary": "Returns the aggregator check-in report",
    "tag": "Management",
    "params": [
      {
        "name": "DtStart",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string",
        "format": "date"
      },
      {
        "name": "DtEnd",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string",
        "format": "date"
      },
      {
        "name": "IdBranch",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "IdBranchOrigin",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "CheckinBranchIds",
        "in": "query",
        "required": false,
        "description": "",
        "type": "array",
        "items": "number"
      },
      {
        "name": "Aggregators",
        "in": "query",
        "required": false,
        "description": "",
        "type": "array",
        "items": "number"
      },
      {
        "name": "Skip",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "Take",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_membermembership_id_member_membership",
    "path": "/api/v1/membermembership/{idMemberMembership}",
    "summary": "Get summary of MemberMemberships by id",
    "tag": "MemberMembership",
    "params": [
      {
        "name": "idMemberMembership",
        "in": "path",
        "required": true,
        "description": "Id MemberMembership",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_members_basic",
    "path": "/api/v1/members/basic",
    "summary": "Get basic member information.",
    "tag": "Members",
    "params": [
      {
        "name": "email",
        "in": "query",
        "required": false,
        "description": "Filter by a member e-mail",
        "type": "string"
      },
      {
        "name": "document",
        "in": "query",
        "required": false,
        "description": "Filter by a member document",
        "type": "string"
      },
      {
        "name": "phone",
        "in": "query",
        "required": false,
        "description": "Filter by a member telephone or cellphone Ex.:1112341234",
        "type": "string"
      },
      {
        "name": "idMember",
        "in": "query",
        "required": false,
        "description": "Filter by member id",
        "type": "integer"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "Total number of records to return. (Maximum of 10000)",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "Total number of records to skip.",
        "type": "integer"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_members_fitcoins",
    "path": "/api/v1/members/fitcoins",
    "summary": "Get member fitcoins",
    "tag": "Members",
    "params": [
      {
        "name": "idMember",
        "in": "query",
        "required": false,
        "description": "Id Member",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_members_latest_transfer",
    "path": "/api/v1/members/latest-transfer",
    "summary": "Get member's latest branch transfer",
    "tag": "Members",
    "params": [
      {
        "name": "idMember",
        "in": "query",
        "required": false,
        "description": "Filter by member id",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_members_services",
    "path": "/api/v1/members/services",
    "summary": "Get member services",
    "tag": "Members",
    "params": [
      {
        "name": "idMember",
        "in": "query",
        "required": false,
        "description": "Filter by member id",
        "type": "integer"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Integer. Optional. Specifies the branch ID for the employee. When provided, the operation will be performed for the specified branch.",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_membership_category",
    "path": "/api/v1/membership/category",
    "summary": "Get memberships categories",
    "tag": "Membership",
    "params": []
  },
  {
    "tool": "evo_v1_parking_document_authorization",
    "path": "/api/v1/parking/document-authorization",
    "summary": "Validates parking access authorization by CPF (`document`) or by `idMember` for a specific branch.",
    "tag": "Parking",
    "params": [
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Branch identifier for the query. If not provided, the current branch from the context is used.",
        "type": "integer"
      },
      {
        "name": "document",
        "in": "query",
        "required": false,
        "description": "CPF of the customer/employee to validate. Provide numbers only.",
        "type": "string"
      },
      {
        "name": "idMember",
        "in": "query",
        "required": false,
        "description": "Identifier of the member (customer or employee) to validate.",
        "type": "integer"
      },
      {
        "name": "personType",
        "in": "query",
        "required": false,
        "description": "Person type related to idMember: 1 for Customer, 2 for Employee. Required when idMember is provided.",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_parking_validate_parking_information",
    "path": "/api/v1/parking/validate-parking-information",
    "summary": "Validates parking access authorization and information by CPF (`document`)",
    "tag": "Parking",
    "params": [
      {
        "name": "document",
        "in": "query",
        "required": false,
        "description": "Member's document to be validated.",
        "type": "string"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "(Optional) Branch ID for validation. If not provided, the current context branch will be used.",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_partnership",
    "path": "/api/v1/partnership",
    "summary": "Get partnerships",
    "tag": "Partnership",
    "params": [
      {
        "name": "status",
        "in": "query",
        "required": false,
        "description": "Filter by status: 0 Both, 1 Active, 2 Inactive",
        "type": "integer"
      },
      {
        "name": "description",
        "in": "query",
        "required": false,
        "description": "Filter by Partnership name",
        "type": "string"
      },
      {
        "name": "dtCreated",
        "in": "query",
        "required": false,
        "description": "Filter by registration date",
        "type": "string",
        "format": "date"
      }
    ]
  },
  {
    "tool": "evo_v1_payables",
    "path": "/api/v1/payables",
    "summary": "Get payables",
    "tag": "Payables",
    "params": [
      {
        "name": "description",
        "in": "query",
        "required": false,
        "description": "Filter by account description",
        "type": "string"
      },
      {
        "name": "dateInputStart",
        "in": "query",
        "required": false,
        "description": "Filter by input of the account starting in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "dateInputEnd",
        "in": "query",
        "required": false,
        "description": "Filter by input of the account ending in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "dueDateStart",
        "in": "query",
        "required": false,
        "description": "Filter by due of the account starting in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "dueDateEnd",
        "in": "query",
        "required": false,
        "description": "Filter by due of the account ending in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "datePaymentStart",
        "in": "query",
        "required": false,
        "description": "Filter by payment of the account starting in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "datePaymentEnd",
        "in": "query",
        "required": false,
        "description": "Filter by payment of the account ending in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "compentenceStart",
        "in": "query",
        "required": false,
        "description": "Filter by competence of the account starting in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "competenceEnd",
        "in": "query",
        "required": false,
        "description": "Filter by competence of the account ending in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "bankAccount",
        "in": "query",
        "required": false,
        "description": "Filter by bank account id. The bank account id can be obtained from the BankAccounts API. Accounts can be concatenated with a comma to search, for example (2,215), in which case it will return paymen…",
        "type": "string"
      },
      {
        "name": "ammountStart",
        "in": "query",
        "required": false,
        "description": "Filter by minimun ammount",
        "type": "number"
      },
      {
        "name": "ammountEnd",
        "in": "query",
        "required": false,
        "description": "Filter by maximun ammount",
        "type": "number"
      },
      {
        "name": "accountStatus",
        "in": "query",
        "required": false,
        "description": "Filter by a comma separated list of status ids. Status: 1 - Opened, 2 - Paid, 3 - Canceled",
        "type": "string"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Filter by branch ID. (Only available when using a multi-location key, ignored otherwise)",
        "type": "integer"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "Total number of records to return. (Maximum of 10000)",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "Total number of records to skip.",
        "type": "integer"
      },
      {
        "name": "idPayable",
        "in": "query",
        "required": false,
        "description": "Filter by payable ID. When it does not exist in the branch, returns an empty list.",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_product",
    "path": "/api/v1/product",
    "summary": "Get products",
    "tag": "Product",
    "params": [
      {
        "name": "idProduct",
        "in": "query",
        "required": false,
        "description": "Filter by Product Id",
        "type": "integer"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Filter by Branch Id (applicable only for general admin token)",
        "type": "integer"
      },
      {
        "name": "name",
        "in": "query",
        "required": false,
        "description": "Filter by product name/description",
        "type": "string"
      },
      {
        "name": "code",
        "in": "query",
        "required": false,
        "description": "Filter by product code",
        "type": "string"
      },
      {
        "name": "onlySellable",
        "in": "query",
        "required": false,
        "description": "Return only sellable products (default = true)",
        "type": "boolean"
      },
      {
        "name": "active",
        "in": "query",
        "required": false,
        "description": "Filter by active/inactive products (used only when onlySellable=false)",
        "type": "boolean"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "Total number of records to return. (Maximum of 10000, default = 25)",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "Total number of records to skip (default = 0)",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_prospects",
    "path": "/api/v1/prospects",
    "summary": "Get prospects",
    "tag": "Prospects",
    "params": [
      {
        "name": "idProspect",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "name",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string"
      },
      {
        "name": "document",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string"
      },
      {
        "name": "email",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string"
      },
      {
        "name": "phone",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string"
      },
      {
        "name": "registerDateStart",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string",
        "format": "date"
      },
      {
        "name": "registerDateEnd",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string",
        "format": "date"
      },
      {
        "name": "conversionDateStart",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string",
        "format": "date"
      },
      {
        "name": "conversionDateEnd",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string",
        "format": "date"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "Total number of records to return. (Maximum of 10000)",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "Total number of records to skip.",
        "type": "integer"
      },
      {
        "name": "gympassId",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string"
      },
      {
        "name": "registerName",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string"
      },
      {
        "name": "whatsappUsername",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string"
      },
      {
        "name": "whatsappBsuid",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Filter by IdBranch (Only available when using a multilocation key, ignored otherwise)",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_prospects_latest_transfer",
    "path": "/api/v1/prospects/latest-transfer",
    "summary": "Get prospect's latest branch transfer",
    "tag": "Prospects",
    "params": [
      {
        "name": "idProspect",
        "in": "query",
        "required": false,
        "description": "Filter by prospect id",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_prospects_services",
    "path": "/api/v1/prospects/services",
    "summary": "Get prospect services",
    "tag": "Prospects",
    "params": [
      {
        "name": "idProspect",
        "in": "query",
        "required": false,
        "description": "Filter by prospect id",
        "type": "integer"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Integer. Optional. Specifies the branch ID for the employee. When provided, the operation will be performed for the specified branch.",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_receivables",
    "path": "/api/v1/receivables",
    "summary": "Get receivables",
    "tag": "Receivables",
    "params": [
      {
        "name": "registrationDateStart",
        "in": "query",
        "required": false,
        "description": "Filter by registration of the account starting in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "registrationDateEnd",
        "in": "query",
        "required": false,
        "description": "Filter by registration of the account ending in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "dueDateStart",
        "in": "query",
        "required": false,
        "description": "Filter by due of the account starting in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "dueDateEnd",
        "in": "query",
        "required": false,
        "description": "Filter by due of the account ending in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "receivingDateStart",
        "in": "query",
        "required": false,
        "description": "Filter by receiving of the account starting in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "receivingDateEnd",
        "in": "query",
        "required": false,
        "description": "Filter by receiving of the account ending in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "competenceDateEnd",
        "in": "query",
        "required": false,
        "description": "Filter by competence of the account ending in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "competenceDateStart",
        "in": "query",
        "required": false,
        "description": "Filter by competence of the account starting in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "cancellationDateStart",
        "in": "query",
        "required": false,
        "description": "Filter by cancellation of the account starting in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "cancellationDateEnd",
        "in": "query",
        "required": false,
        "description": "Filter by cancellation of the account ending in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "chargeDateStart",
        "in": "query",
        "required": false,
        "description": "Filter by charge of the account starting in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "chargeDateEnd",
        "in": "query",
        "required": false,
        "description": "Filter by charge of the account ending in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "updateDateStart",
        "in": "query",
        "required": false,
        "description": "Filter by update of the account starting in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "updateDateEnd",
        "in": "query",
        "required": false,
        "description": "Filter by update of the account ending in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "description",
        "in": "query",
        "required": false,
        "description": "Filter by description",
        "type": "string"
      },
      {
        "name": "ammountStart",
        "in": "query",
        "required": false,
        "description": "Filter by minimun ammount",
        "type": "number"
      },
      {
        "name": "ammountEnd",
        "in": "query",
        "required": false,
        "description": "Filter by maximun ammount",
        "type": "number"
      },
      {
        "name": "paymentTypes",
        "in": "query",
        "required": false,
        "description": "Filter by a comma separated list of payment types id. Types: 1 - Money, 2 - Credit Card, 3 - Debit Card, 4 - Check, 5 - Boleto Bancário, 6 - PagSeguro, 7 - Deposit, 8 - Account Debit, 9 - Internet, 1…",
        "type": "string"
      },
      {
        "name": "accountStatus",
        "in": "query",
        "required": false,
        "description": "Filter by a comma separated list of status ids. Status: 1 - Opened, 2 - Received, 3 - Canceled, 4 - Overdue",
        "type": "string"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "Total number of records to return. (Maximum of 10000)",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "Total number of records to skip.",
        "type": "integer"
      },
      {
        "name": "memberId",
        "in": "query",
        "required": false,
        "description": "Filter by a member Id.",
        "type": "integer"
      },
      {
        "name": "idSale",
        "in": "query",
        "required": false,
        "description": "Filter by a sale Id.",
        "type": "integer"
      },
      {
        "name": "idReceivable",
        "in": "query",
        "required": false,
        "description": "Filter by a receivable Id.",
        "type": "integer"
      },
      {
        "name": "invoiceDateStart",
        "in": "query",
        "required": false,
        "description": "Filter by invoice date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "invoiceDateEnd",
        "in": "query",
        "required": false,
        "description": "Filter by invoice date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "invoiceCanceledDateStart",
        "in": "query",
        "required": false,
        "description": "Filter by canceled invoice date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "invoiceCanceledDateEnd",
        "in": "query",
        "required": false,
        "description": "Filter by canceled invoice date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "saleDateStart",
        "in": "query",
        "required": false,
        "description": "Filter by sale date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "saleDateEnd",
        "in": "query",
        "required": false,
        "description": "Filter by sale date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Filter by branch Id.",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_receivables_charge_batches_charge_batch_id",
    "path": "/api/v1/receivables/charge-batches/{chargeBatchId}",
    "summary": "Gets the details of a specific charge batch.",
    "tag": "Receivables",
    "params": [
      {
        "name": "chargeBatchId",
        "in": "path",
        "required": true,
        "description": "The identifier of the charge batch to retrieve details for.",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_receivables_debtors",
    "path": "/api/v1/receivables/debtors",
    "summary": "Gets a list of debts and current status (Similar to the Collections - Default report)",
    "tag": "Receivables",
    "params": [
      {
        "name": "dueDateStart",
        "in": "query",
        "required": false,
        "description": "Filter by due date of the account starting in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "dueDateEnd",
        "in": "query",
        "required": false,
        "description": "Filter by due date of the account ending in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "registrationDateStart",
        "in": "query",
        "required": false,
        "description": "Filter by registration of the account starting in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "registrationDateEnd",
        "in": "query",
        "required": false,
        "description": "Filter by registration of the account ending in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "paymentDateStart",
        "in": "query",
        "required": false,
        "description": "Filter by payment of the account starting in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "paymentDateEnd",
        "in": "query",
        "required": false,
        "description": "Filter by payment of the account ending in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "membersIds",
        "in": "query",
        "required": false,
        "description": "Filter by a list of members Id. Values ​​must be separated by commas",
        "type": "string"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "Total number of records to return. (Maximum of 100; 500 between 00:00 and 05:59)",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "Total number of records to skip.",
        "type": "integer"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Filter by IdBranch (Only available when using a multilocation key and membersIds is not null or empty, ignored otherwise.)",
        "type": "integer"
      },
      {
        "name": "memberStatus",
        "in": "query",
        "required": false,
        "description": "Optional. Filter by member status. Possible values: 1 = Active, 2 = Inactive. You may provide multiple values separated by commas (1,2).",
        "type": "string"
      },
      {
        "name": "debtStatus",
        "in": "query",
        "required": false,
        "description": "Optional. Filter by debt status. Possible values: 1 = Opened, 2 = Recovered, 3 = Canceled. You may provide multiple values separated by commas (1,2).",
        "type": "string"
      }
    ]
  },
  {
    "tool": "evo_v1_receivables_pjbank_boletos",
    "path": "/api/v1/receivables/pjbank-boletos",
    "summary": "List PJBank boletos (bank slips) for the authenticated branch.",
    "tag": "Receivables",
    "params": [
      {
        "name": "dateStart",
        "in": "query",
        "required": true,
        "description": "Filter by due date start (yyyy-mm-dd). Default filter when paid is not set.",
        "type": "string",
        "format": "date"
      },
      {
        "name": "dateEnd",
        "in": "query",
        "required": true,
        "description": "Filter by due date end (yyyy-mm-dd).",
        "type": "string",
        "format": "date"
      },
      {
        "name": "paid",
        "in": "query",
        "required": true,
        "description": "When true, returns only paid boletos and date filters are applied to the payment date.",
        "type": "boolean"
      },
      {
        "name": "page",
        "in": "query",
        "required": true,
        "description": "Page number to retrieve. PJBank paginates results in fixed pages of 50 items. Use page=1 for the first 50 records, page=2 for the next 50, and so on.",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_receivables_receivables_conciliation",
    "path": "/api/v1/receivables/receivables-conciliation",
    "summary": "Get receivables conciliation report",
    "tag": "Receivables",
    "params": [
      {
        "name": "conciliationType",
        "in": "query",
        "required": true,
        "description": "Filter by conciliator: 0 - Equals",
        "type": "integer"
      },
      {
        "name": "chargeDateStart",
        "in": "query",
        "required": true,
        "description": "Filter by charge of the account starting in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "chargeDateEnd",
        "in": "query",
        "required": true,
        "description": "Filter by charge of the account ending in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "codErp",
        "in": "query",
        "required": false,
        "description": "Filter by codErp conciliator",
        "type": "string"
      },
      {
        "name": "idsBranch",
        "in": "query",
        "required": false,
        "description": "Filter by a comma separated list of branch id",
        "type": "string"
      },
      {
        "name": "status",
        "in": "query",
        "required": false,
        "description": "Filter by status conciliation: -1 - All, 0 - Awaiting Reconciliation, 1 - Reconciled, 2 - Manually Reconciled, 3 - Justified, 4 - Not Applicable, 5 - Evo Reconciled",
        "type": "integer"
      },
      {
        "name": "authorization",
        "in": "query",
        "required": false,
        "description": "Filter by authorization code of the transaction",
        "type": "string"
      },
      {
        "name": "idMemberPayer",
        "in": "query",
        "required": false,
        "description": "Filter by the member/payer ID",
        "type": "integer"
      },
      {
        "name": "saleDateStart",
        "in": "query",
        "required": false,
        "description": "Filter by sale date starting in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "saleDateEnd",
        "in": "query",
        "required": false,
        "description": "Filter by sale date ending in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "nsu",
        "in": "query",
        "required": false,
        "description": "Filter by NSU (Unique Sequential Number) of the transaction",
        "type": "string"
      },
      {
        "name": "tid",
        "in": "query",
        "required": false,
        "description": "Filter by TID (Transaction Identifier) of the transaction",
        "type": "string"
      },
      {
        "name": "amount",
        "in": "query",
        "required": false,
        "description": "Filter by the transaction amount",
        "type": "number"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "Total number of records to return. (Maximum of 10000)",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "Total number of records to skip.",
        "type": "integer"
      },
      {
        "name": "orderBy",
        "in": "query",
        "required": false,
        "description": "Field name to order the results",
        "type": "string"
      },
      {
        "name": "orderDirection",
        "in": "query",
        "required": false,
        "description": "Order direction (asc or desc)",
        "type": "string"
      }
    ]
  },
  {
    "tool": "evo_v1_revenuecenter",
    "path": "/api/v1/revenuecenter",
    "summary": "Get cost center",
    "tag": "Receivables",
    "params": [
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "Total number of records to return.",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "Total number of records to skip.",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_sales_by_session_id",
    "path": "/api/v1/sales/by-session-id",
    "summary": "Get sales bySessionId",
    "tag": "Sales",
    "params": [
      {
        "name": "sessionId",
        "in": "query",
        "required": false,
        "description": "Filter by a session Id.",
        "type": "string"
      },
      {
        "name": "date",
        "in": "query",
        "required": false,
        "description": "Filter by registration of the sale in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      }
    ]
  },
  {
    "tool": "evo_v1_sales_sales_items",
    "path": "/api/v1/sales/sales-items",
    "summary": "Return itens for sale -> site/totem",
    "tag": "Sales",
    "params": [
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_service",
    "path": "/api/v1/service",
    "summary": "Get services",
    "tag": "Service",
    "params": [
      {
        "name": "idService",
        "in": "query",
        "required": false,
        "description": "Filter by Service Id",
        "type": "integer"
      },
      {
        "name": "name",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Filber by service IdBranch (Only available when using a multilocation key, ignored otherwise)",
        "type": "integer"
      },
      {
        "name": "showOnlyExternalIntegrationServices",
        "in": "query",
        "required": false,
        "description": "Filter by services that allow usage in external integrations.",
        "type": "boolean"
      },
      {
        "name": "showActivities",
        "in": "query",
        "required": false,
        "description": "Include activities in the return.",
        "type": "boolean"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "Total number of records to return. (Maximum of 10000, default of 25)",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "Total number of records to skip.",
        "type": "integer"
      },
      {
        "name": "active",
        "in": "query",
        "required": false,
        "description": "Filter by active/inactive services",
        "type": "boolean"
      }
    ]
  },
  {
    "tool": "evo_v1_voucher",
    "path": "/api/v1/voucher",
    "summary": "Get vouchers",
    "tag": "Voucher",
    "params": [
      {
        "name": "idVoucher",
        "in": "query",
        "required": false,
        "description": "Filter by Voucher Id",
        "type": "integer"
      },
      {
        "name": "name",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Filber by Voucher IdBranch (Only available when using a multilocation key, ignored otherwise)",
        "type": "integer"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "Total of register to return (Maximun of 50)",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "Total of register to skip",
        "type": "integer"
      },
      {
        "name": "valid",
        "in": "query",
        "required": false,
        "description": "",
        "type": "boolean"
      },
      {
        "name": "type",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_voucher_get_codes_by_voucher_id_id_voucher",
    "path": "/api/v1/voucher/get-codes-by-voucher-id/{idVoucher}",
    "summary": "Get all vouchers code by voucher id",
    "tag": "Voucher",
    "params": [
      {
        "name": "idVoucher",
        "in": "path",
        "required": true,
        "description": "Filter by Voucher Id",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "Total of register to skip",
        "type": "integer"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "Total of register to return (Maximun of 50)",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_workout_default_workout",
    "path": "/api/v1/workout/default-workout",
    "summary": "Get all default workouts",
    "tag": "Workout",
    "params": [
      {
        "name": "idEmployee",
        "in": "query",
        "required": false,
        "description": "The ID of the employee associated with the workouts.",
        "type": "integer"
      },
      {
        "name": "idTag",
        "in": "query",
        "required": false,
        "description": "The optional ID of the tag associated with the workouts.",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v1_workout_workout_monthyear_professor",
    "path": "/api/v1/workout/workout-monthyear-professor",
    "summary": "Get all client's or prospect's or employee's workouts by month, year or idProfessor",
    "tag": "Workout",
    "params": [
      {
        "name": "idProfessor",
        "in": "query",
        "required": false,
        "description": "The ID of the professor who create the workouts.",
        "type": "integer"
      },
      {
        "name": "month",
        "in": "query",
        "required": false,
        "description": "Month to get the workouts.",
        "type": "integer"
      },
      {
        "name": "year",
        "in": "query",
        "required": false,
        "description": "Year to get the workouts.",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "Total number of records to skip.",
        "type": "integer"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "Total number of records to return. (Maximum of 50)",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v2_access_control_turnstiles",
    "path": "/api/v2/accessControl/turnstiles",
    "summary": "Get access control turnstiles",
    "tag": "AccessControl",
    "params": [
      {
        "name": "serialNumber",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v2_activities_enroll",
    "path": "/api/v2/activities/enroll",
    "summary": "Get activities schedule by enrollment",
    "tag": "Activities",
    "params": [
      {
        "name": "idMember",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "idMemberMemberShip",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "date",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string",
        "format": "date"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v2_activities_enroll_member",
    "path": "/api/v2/activities/enroll/member",
    "summary": "Get enrollment details for a member",
    "tag": "Activities",
    "params": [
      {
        "name": "idMember",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "status",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string"
      }
    ]
  },
  {
    "tool": "evo_v2_activities_member_sessions",
    "path": "/api/v2/activities/member/sessions",
    "summary": "Get activity sessions for a member",
    "tag": "Activities",
    "params": [
      {
        "name": "idMember",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "idProspect",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "dateStart",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string",
        "format": "date"
      },
      {
        "name": "dateEnd",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string",
        "format": "date"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "idActivities",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string"
      }
    ]
  },
  {
    "tool": "evo_v2_employees",
    "path": "/api/v2/employees",
    "summary": "Get employees",
    "tag": "Employees",
    "params": [
      {
        "name": "idEmployee",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "name",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string"
      },
      {
        "name": "email",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "Total number of records to return.",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "Total number of records to skip.",
        "type": "integer"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Branch Id (required when using a multilocation key, optional for the general admin key, ignored otherwise)",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v2_entries",
    "path": "/api/v2/entries",
    "summary": "Get entries",
    "tag": "Entries",
    "params": [
      {
        "name": "registerDateStart",
        "in": "query",
        "required": false,
        "description": "DateTime date start",
        "type": "string",
        "format": "date"
      },
      {
        "name": "registerDateEnd",
        "in": "query",
        "required": false,
        "description": "DateTime date end",
        "type": "string",
        "format": "date"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "Total number of records to return. (Maximum of 10000)",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "Total number of records to skip.",
        "type": "integer"
      },
      {
        "name": "IdEntry",
        "in": "query",
        "required": false,
        "description": "ID of the entry to return.",
        "type": "integer"
      },
      {
        "name": "idMember",
        "in": "query",
        "required": false,
        "description": "ID of the member to return",
        "type": "integer"
      },
      {
        "name": "idProspect",
        "in": "query",
        "required": false,
        "description": "ID of the prospect to return",
        "type": "integer"
      },
      {
        "name": "idEmployee",
        "in": "query",
        "required": false,
        "description": "ID of the employee to return",
        "type": "integer"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Branch Id (required when using a multilocation key, ignored otherwise)",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v2_fitness_assessment",
    "path": "/api/v2/fitness-assessment",
    "summary": "List a member's fitness assessments or get the answers of one",
    "tag": "FitnessAssessment",
    "params": [
      {
        "name": "idFitnessAssessment",
        "in": "query",
        "required": false,
        "description": "Id of the assessment to return in full. When omitted, the summary list is returned.",
        "type": "integer"
      },
      {
        "name": "idMember",
        "in": "query",
        "required": false,
        "description": "Member id. Required.",
        "type": "integer"
      },
      {
        "name": "idEmployee",
        "in": "query",
        "required": false,
        "description": "List mode: filter by the employee who performed the assessment.",
        "type": "integer"
      },
      {
        "name": "dateCreatedStart",
        "in": "query",
        "required": false,
        "description": "Assessments performed on or after this date (`yyyy-MM-dd`).",
        "type": "string",
        "format": "date"
      },
      {
        "name": "dateCreatedEnd",
        "in": "query",
        "required": false,
        "description": "Assessments performed on or before this date (`yyyy-MM-dd`).",
        "type": "string",
        "format": "date"
      },
      {
        "name": "idType",
        "in": "query",
        "required": false,
        "description": "Filter by assessment type: `1` Anamnesis, `2` Bioimpedance, `3` Circumferences, `4` Skinfolds. Send it with `idFitnessAssessment`.",
        "type": "integer"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "List mode: number of records to return. Default and maximum: 50.",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "List mode: number of records to skip. Default: 0.",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v2_fitness_assessment_management",
    "path": "/api/v2/fitness-assessment/management",
    "summary": "List fitness assessments",
    "tag": "FitnessAssessment",
    "params": [
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Multi-location keys only: branch ids to filter. Repeat the parameter for several branches (`idBranch=1&idBranch=2`). Branches the key has no access to are ignored.",
        "type": "array",
        "items": "number"
      },
      {
        "name": "createdDateStart",
        "in": "query",
        "required": false,
        "description": "Assessments performed on or after this date and time.",
        "type": "string",
        "format": "date"
      },
      {
        "name": "createdDateEnd",
        "in": "query",
        "required": false,
        "description": "Assessments performed on or before this date and time. The time is considered: to include the whole day, send the end of the day (e.g. `2026-10-31T23:59:59`).",
        "type": "string",
        "format": "date"
      },
      {
        "name": "expiryDateStart",
        "in": "query",
        "required": false,
        "description": "Assessments that expire on or after this date.",
        "type": "string",
        "format": "date"
      },
      {
        "name": "expiryDateEnd",
        "in": "query",
        "required": false,
        "description": "Assessments that expire on or before this date.",
        "type": "string",
        "format": "date"
      },
      {
        "name": "expired",
        "in": "query",
        "required": false,
        "description": "`true`: only expired assessments (expiry date before the current date and time of the branch). `false`: only assessments still valid.",
        "type": "boolean"
      },
      {
        "name": "idMember",
        "in": "query",
        "required": false,
        "description": "Filter by member.",
        "type": "integer"
      },
      {
        "name": "idEmployee",
        "in": "query",
        "required": false,
        "description": "Filter by the employee who performed the assessment.",
        "type": "integer"
      },
      {
        "name": "idProtocol",
        "in": "query",
        "required": false,
        "description": "Filter by protocol. Combine with `type`, since protocol ids are unique only within a type. When informed, Skinfolds assessments (which have no protocol) are not returned.",
        "type": "integer"
      },
      {
        "name": "type",
        "in": "query",
        "required": false,
        "description": "Filter by assessment type: `1` Anamnesis, `2` Bioimpedance, `3` Circumferences, `4` Skinfolds.",
        "type": "integer"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "Number of records to return. Default and maximum: 200.",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "Number of records to skip. Default: 0.",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v2_fitness_assessment_protocol_detail_id_protocol",
    "path": "/api/v2/fitness-assessment/protocol-detail/{idProtocol}",
    "summary": "Get the field configuration of a protocol",
    "tag": "FitnessAssessment",
    "params": [
      {
        "name": "idProtocol",
        "in": "path",
        "required": true,
        "description": "Protocol id, as returned in `idProtocol` by the protocol list.",
        "type": "integer"
      },
      {
        "name": "type",
        "in": "query",
        "required": false,
        "description": "Protocol type: `1` Anamnesis, `2` Bioimpedance, `3` Circumferences. Default: `2`. Skinfolds (`4`) has no configurable protocol.",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v2_fitness_assessment_protocol_id_branch",
    "path": "/api/v2/fitness-assessment/protocol/{idBranch}",
    "summary": "List the fitness assessment protocols of a branch",
    "tag": "FitnessAssessment",
    "params": [
      {
        "name": "idBranch",
        "in": "path",
        "required": true,
        "description": "Branch id. With a single-branch key this value is ignored and the key's own branch is used; with a multi-location key, it must be one of the branches the key has access to.",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v2_invoices_get_invoices",
    "path": "/api/v2/invoices/get-invoices",
    "summary": "Get invoices by date",
    "tag": "Invoices",
    "params": [
      {
        "name": "issueDateStart",
        "in": "query",
        "required": false,
        "description": "Filter by the invoice issuance that starts on a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "issueDateEnd",
        "in": "query",
        "required": false,
        "description": "Filter by the invoice issuance that ends on a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "competencyDateStart",
        "in": "query",
        "required": false,
        "description": "Filter by the invoice competency that starts on a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "competencyDateEnd",
        "in": "query",
        "required": false,
        "description": "Filter by the invoice competency that ends on a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "sendDateStart",
        "in": "query",
        "required": false,
        "description": "Filter by the invoice sending that starts on a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "sendDateEnd",
        "in": "query",
        "required": false,
        "description": "Filter by the invoice sending that ends on a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "Total number of records to return. (Maximum of 10000)",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "Total number of records to skip.",
        "type": "integer"
      },
      {
        "name": "idMember",
        "in": "query",
        "required": false,
        "description": "Filter by a member Id",
        "type": "integer"
      },
      {
        "name": "statusInvoice",
        "in": "query",
        "required": false,
        "description": "Filter by a comma separated list of status invoice. Status: 1 - Issued, 2 - With error, 3 - Canceled , 4 - Created",
        "type": "string"
      },
      {
        "name": "typesInvoice",
        "in": "query",
        "required": false,
        "description": "Filter by types of invoice separated by comma.: 1 - NFSe, 2 - NFe, 3 - NFCe. Example: 1,2,3",
        "type": "string"
      },
      {
        "name": "lastDateChangeStart",
        "in": "query",
        "required": false,
        "description": "Filter by last invoice change that starts on a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "lastDateChangeEnd",
        "in": "query",
        "required": false,
        "description": "Filter by last invoice change that ends on a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "nfNumber",
        "in": "query",
        "required": false,
        "description": "Filter by invoice Id",
        "type": "string"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Filter by branch Id",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v2_management_activeclients",
    "path": "/api/v2/management/activeclients",
    "summary": "Get active clients",
    "tag": "Management",
    "params": []
  },
  {
    "tool": "evo_v2_management_not_renewed",
    "path": "/api/v2/management/not-renewed",
    "summary": "Get non-renewed clients",
    "tag": "Management",
    "params": [
      {
        "name": "dtStart",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string",
        "format": "date"
      },
      {
        "name": "dtEnd",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string",
        "format": "date"
      }
    ]
  },
  {
    "tool": "evo_v2_management_prospects",
    "path": "/api/v2/management/prospects",
    "summary": "Get prospects",
    "tag": "Management",
    "params": [
      {
        "name": "dtStart",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string",
        "format": "date"
      },
      {
        "name": "dtEnd",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string",
        "format": "date"
      }
    ]
  },
  {
    "tool": "evo_v2_members",
    "path": "/api/v2/members",
    "summary": "Get members",
    "tag": "Members",
    "params": [
      {
        "name": "name",
        "in": "query",
        "required": false,
        "description": "Filter by members name",
        "type": "string"
      },
      {
        "name": "email",
        "in": "query",
        "required": false,
        "description": "Filter by a member e-mail",
        "type": "string"
      },
      {
        "name": "document",
        "in": "query",
        "required": false,
        "description": "Filter by a member document",
        "type": "string"
      },
      {
        "name": "phone",
        "in": "query",
        "required": false,
        "description": "Filter by a member telephone or cellphone Ex.:1112341234",
        "type": "string"
      },
      {
        "name": "conversionDateStart",
        "in": "query",
        "required": false,
        "description": "Filter by a member conversion date starting in: (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "conversionDateEnd",
        "in": "query",
        "required": false,
        "description": "Filter by a member conversion date ending in: (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "registerDateStart",
        "in": "query",
        "required": false,
        "description": "Filter by a member register date starting in: (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "registerDateEnd",
        "in": "query",
        "required": false,
        "description": "Filter by a member register date ending in: (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "membershipStartDateStart",
        "in": "query",
        "required": false,
        "description": "Filter by a membership start date from: (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "membershipStartDateEnd",
        "in": "query",
        "required": false,
        "description": "Filter by a membership start date to: (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "membershipCancelDateStart",
        "in": "query",
        "required": false,
        "description": "Filter by a membership cancel date from: (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "membershipCancelDateEnd",
        "in": "query",
        "required": false,
        "description": "Filter by a membership cancel date to: (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "status",
        "in": "query",
        "required": false,
        "description": "Filter by a member state: 1 - Active (Suspendeds and Vips included), 2 - Inactive",
        "type": "integer"
      },
      {
        "name": "tokenGympass",
        "in": "query",
        "required": false,
        "description": "Filter by the member gympass token gympass",
        "type": "string"
      },
      {
        "name": "codeTotalpass",
        "in": "query",
        "required": false,
        "description": "Filter by the member totalpass code",
        "type": "string"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "Total number of records to return. (Maximum of 10000)",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "Total number of records to skip.",
        "type": "integer"
      },
      {
        "name": "idsMembers",
        "in": "query",
        "required": false,
        "description": "Filter by member ids. Add member ids separated by comma. Example: 1,2,3",
        "type": "string"
      },
      {
        "name": "onlyPersonal",
        "in": "query",
        "required": false,
        "description": "Show only personal trainers",
        "type": "boolean"
      },
      {
        "name": "personalType",
        "in": "query",
        "required": false,
        "description": "Filter by personal type: 1 - Internal, 2 - External",
        "type": "integer"
      },
      {
        "name": "showActivityData",
        "in": "query",
        "required": false,
        "description": "Show activity data from member",
        "type": "boolean"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Filber by membership IdBranch (Only available when using a multilocation key, ignored otherwise)",
        "type": "integer"
      },
      {
        "name": "updateDate",
        "in": "query",
        "required": false,
        "description": "Filter only members that have update data greater than or equal: (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "showMemberships",
        "in": "query",
        "required": false,
        "description": "Show memberships data from member",
        "type": "boolean"
      },
      {
        "name": "showsResponsibles",
        "in": "query",
        "required": false,
        "description": "Show responsibles data from member",
        "type": "boolean"
      },
      {
        "name": "membershipEndDateStart",
        "in": "query",
        "required": false,
        "description": "Filter by a membership end date from: (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "membershipEndDateEnd",
        "in": "query",
        "required": false,
        "description": "Filter by a membership end date to: (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "registerName",
        "in": "query",
        "required": false,
        "description": "Filter by members register name",
        "type": "string"
      },
      {
        "name": "whatsappUsername",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string"
      },
      {
        "name": "whatsappBsuid",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string"
      }
    ]
  },
  {
    "tool": "evo_v2_members_active_members",
    "path": "/api/v2/members/active-members",
    "summary": "Retrieves active members from a specific branch or from all branches",
    "tag": "Members",
    "params": [
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Branch ID. If is not null, returns active members from the specified branch only. If is null and the token is associated with branch 0 or less (indicating multi-branch access), returns active members…",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v2_members_id_member",
    "path": "/api/v2/members/{idMember}",
    "summary": "Get member profile",
    "tag": "Members",
    "params": [
      {
        "name": "idMember",
        "in": "path",
        "required": true,
        "description": "Filter by a member",
        "type": "integer"
      },
      {
        "name": "showMemberships",
        "in": "query",
        "required": false,
        "description": "Show memberships data from member",
        "type": "boolean"
      },
      {
        "name": "showsResponsibles",
        "in": "query",
        "required": false,
        "description": "Show responsibles data from member",
        "type": "boolean"
      },
      {
        "name": "usePhotoFromMobileApp",
        "in": "query",
        "required": false,
        "description": "Use photo from mobile app",
        "type": "boolean"
      },
      {
        "name": "showAccessControlQRcode",
        "in": "query",
        "required": false,
        "description": "Show ccessControlQRcode data from member",
        "type": "boolean"
      }
    ]
  },
  {
    "tool": "evo_v2_prospects_interests",
    "path": "/api/v2/prospects/interests",
    "summary": "Get interests list",
    "tag": "Prospects",
    "params": []
  },
  {
    "tool": "evo_v2_sales",
    "path": "/api/v2/sales",
    "summary": "Get sales",
    "tag": "Sales",
    "params": [
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Filter by a branch Id.",
        "type": "integer"
      },
      {
        "name": "idMember",
        "in": "query",
        "required": false,
        "description": "Filter by a member Id.",
        "type": "integer"
      },
      {
        "name": "dateSaleStart",
        "in": "query",
        "required": false,
        "description": "Filter by registration of the sales starting in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "dateSaleEnd",
        "in": "query",
        "required": false,
        "description": "Filter by registration of the sales ending in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "removalDateStart",
        "in": "query",
        "required": false,
        "description": "Filter by removal of the sales starting in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "removalDateEnd",
        "in": "query",
        "required": false,
        "description": "Filter by removal of the sales ending in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "receivablesRegistrationDateStart",
        "in": "query",
        "required": false,
        "description": "Filter sales that had receivables starting in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "receivablesRegistrationDateEnd",
        "in": "query",
        "required": false,
        "description": "Filter sales that had receivables ending in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "updatedReceivableStartDate",
        "in": "query",
        "required": false,
        "description": "Filter sales that had receivables changes starting in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "updatedReceivableEndDate",
        "in": "query",
        "required": false,
        "description": "Filter sales that had receivables changes ending in a date (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "showReceivables",
        "in": "query",
        "required": false,
        "description": "Flag to show sale receivables and sale value without credit value",
        "type": "boolean"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "Total number of records to return. (Maximum of 10000, default of 25)",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "Total number of records to skip.",
        "type": "integer"
      },
      {
        "name": "onlyMembership",
        "in": "query",
        "required": false,
        "description": "Return only sales with membership.",
        "type": "boolean"
      },
      {
        "name": "atLeastMonthly",
        "in": "query",
        "required": false,
        "description": "remove membership less than 30 days (as old removeMonthly)",
        "type": "boolean"
      },
      {
        "name": "flSwimming",
        "in": "query",
        "required": false,
        "description": "Filters memberships by the swimming flag",
        "type": "boolean"
      },
      {
        "name": "showOnlyActiveMemberships",
        "in": "query",
        "required": false,
        "description": "",
        "type": "boolean"
      },
      {
        "name": "showAllowLocker",
        "in": "query",
        "required": false,
        "description": "",
        "type": "boolean"
      },
      {
        "name": "onlyTotalPass",
        "in": "query",
        "required": false,
        "description": "",
        "type": "boolean"
      },
      {
        "name": "updateDate",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string",
        "format": "date"
      }
    ]
  },
  {
    "tool": "evo_v2_sales_id_sale",
    "path": "/api/v2/sales/{idSale}",
    "summary": "Get sale by Id",
    "tag": "Sales",
    "params": [
      {
        "name": "idSale",
        "in": "path",
        "required": true,
        "description": "",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v2_states",
    "path": "/api/v2/states",
    "summary": "Get all states for the current user's country",
    "tag": "States",
    "params": []
  },
  {
    "tool": "evo_v2_webhook",
    "path": "/api/v2/webhook",
    "summary": "List all webhooks created",
    "tag": "Webhook",
    "params": []
  },
  {
    "tool": "evo_v2_workout_default_client_workout",
    "path": "/api/v2/workout/default-client-workout",
    "summary": "Get all client's or prospect's or employee's workouts of the new prescription",
    "tag": "Workout",
    "params": [
      {
        "name": "idClient",
        "in": "query",
        "required": false,
        "description": "The ID of the client to get the workouts.",
        "type": "integer"
      },
      {
        "name": "idProspect",
        "in": "query",
        "required": false,
        "description": "The ID of the prospect to get the workouts.",
        "type": "integer"
      },
      {
        "name": "idEmployee",
        "in": "query",
        "required": false,
        "description": "The ID of the employee to get the workouts.",
        "type": "integer"
      },
      {
        "name": "idWorkout",
        "in": "query",
        "required": false,
        "description": "The ID to get the workout.",
        "type": "integer"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Branch id. Optional for a general admin key - when omitted, searches every branch of the token's company and each workout carries its own idBranch. Required for a multilocation key. For a branch key …",
        "type": "integer"
      },
      {
        "name": "inactive",
        "in": "query",
        "required": false,
        "description": "Include workouts already expired. Default is false.",
        "type": "boolean"
      },
      {
        "name": "deleted",
        "in": "query",
        "required": false,
        "description": "Include deleted workouts. Default is false.",
        "type": "boolean"
      }
    ]
  },
  {
    "tool": "evo_v2_workout_default_workout",
    "path": "/api/v2/workout/default-workout",
    "summary": "Get all default workouts of the new prescription",
    "tag": "Workout",
    "params": [
      {
        "name": "idEmployee",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "idTag",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v2_workout_exercises",
    "path": "/api/v2/workout/exercises",
    "summary": "Get all Exercises",
    "tag": "Workout",
    "params": [
      {
        "name": "searchText",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string"
      },
      {
        "name": "muscleGroups",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string"
      },
      {
        "name": "exerciseGroup",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "showSimilarExercises",
        "in": "query",
        "required": false,
        "description": "",
        "type": "boolean"
      }
    ]
  },
  {
    "tool": "evo_v2_workout_management_workouts",
    "path": "/api/v2/workout/management-workouts",
    "summary": "Get the latest workout of each active member of a branch (management view). Only workouts from the new workout version are considered - a member whose workouts all come from the legacy version is reported as having no workout (workoutStatus 0).",
    "tag": "Workout",
    "params": [
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Branch id. Optional for a general admin key - when omitted, returns every branch and each record carries its own idBranch. Required for a multilocation key. For a branch key the scope is always the t…",
        "type": "integer"
      },
      {
        "name": "workoutStatus",
        "in": "query",
        "required": false,
        "description": "0 = no workout, 1 = expired, 2 = active, 4 = start date in the future",
        "type": "integer"
      },
      {
        "name": "idInstructor",
        "in": "query",
        "required": false,
        "description": "Instructor who prescribed the workout",
        "type": "integer"
      },
      {
        "name": "createdDateStart",
        "in": "query",
        "required": false,
        "description": "Workout creation date - start of the range (inclusive)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "createdDateEnd",
        "in": "query",
        "required": false,
        "description": "Workout creation date - end of the range (inclusive, whole day)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "expiryDateStart",
        "in": "query",
        "required": false,
        "description": "Workout expiry date - start of the range (inclusive)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "expiryDateEnd",
        "in": "query",
        "required": false,
        "description": "Workout expiry date - end of the range (inclusive, whole day)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "editDateStart",
        "in": "query",
        "required": false,
        "description": "Workout last edit date - start of the range (inclusive). Workouts never edited are not returned by this filter.",
        "type": "string",
        "format": "date"
      },
      {
        "name": "editDateEnd",
        "in": "query",
        "required": false,
        "description": "Workout last edit date - end of the range (inclusive, whole day)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "lastSessionDateStart",
        "in": "query",
        "required": false,
        "description": "Date of the member's last completed session - start of the range (inclusive)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "lastSessionDateEnd",
        "in": "query",
        "required": false,
        "description": "Date of the member's last completed session - end of the range (inclusive, whole day)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "Page size. Capped at 50; higher or non-positive values fall back to 50.",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "Number of records to skip",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v2_workout_workout_monthyear_professor",
    "path": "/api/v2/workout/workout-monthyear-professor",
    "summary": "Get all client's or prospect's or employee's workouts of the new prescription by month, year or idProfessor",
    "tag": "Workout",
    "params": [
      {
        "name": "idProfessor",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "month",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "year",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v3_membermembership",
    "path": "/api/v3/membermembership",
    "summary": "Get summary of MemberMemberships (active, canceled, or specific types).",
    "tag": "MemberMembership",
    "params": [
      {
        "name": "idMember",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "idMembership",
        "in": "query",
        "required": false,
        "description": "",
        "type": "integer"
      },
      {
        "name": "memberName",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string"
      },
      {
        "name": "registerDateStart",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string",
        "format": "date"
      },
      {
        "name": "registerDateEnd",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string",
        "format": "date"
      },
      {
        "name": "cancelDateStart",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string",
        "format": "date"
      },
      {
        "name": "cancelDateEnd",
        "in": "query",
        "required": false,
        "description": "",
        "type": "string",
        "format": "date"
      },
      {
        "name": "showTransfers",
        "in": "query",
        "required": false,
        "description": "Show transferred contracts.",
        "type": "boolean"
      },
      {
        "name": "showAggregators",
        "in": "query",
        "required": false,
        "description": "Show aggregators contracts.",
        "type": "boolean"
      },
      {
        "name": "showVips",
        "in": "query",
        "required": false,
        "description": "Show VIP category contracts.",
        "type": "boolean"
      },
      {
        "name": "contractType",
        "in": "query",
        "required": false,
        "description": "Filter by a comma separated list of types of contract. types: 1 - Common, 3 - Plan extension, 4 - Locking extension, 5 - Monthly recurring, 6 - Recurring monthly with validity, 7 - Monthly recurring …",
        "type": "string"
      },
      {
        "name": "statusMemberMembership",
        "in": "query",
        "required": false,
        "description": "Filter by status: 1 - Active, 2 - Canceled, 3 - Expired, 4 - Suspended, 5 - In queue. If null, returns all.",
        "type": "integer"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "Total number of records to return. (Maximum of 10000, default of 25)",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "Total number of records to skip.",
        "type": "integer"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Branch Id (required when using a multilocation key, optional for the general admin key, ignored otherwise)",
        "type": "integer"
      }
    ]
  },
  {
    "tool": "evo_v3_membership",
    "path": "/api/v3/membership",
    "summary": "Get memberships",
    "tag": "Membership",
    "params": [
      {
        "name": "idMembership",
        "in": "query",
        "required": false,
        "description": "Filter by membership Id",
        "type": "integer"
      },
      {
        "name": "name",
        "in": "query",
        "required": false,
        "description": "Filter by membership name",
        "type": "string"
      },
      {
        "name": "idBranch",
        "in": "query",
        "required": false,
        "description": "Filter by membership IdBranch (Only available when using a multilocation key, ignored otherwise)",
        "type": "integer"
      },
      {
        "name": "take",
        "in": "query",
        "required": false,
        "description": "Total number of records to return. (Maximum of 10000, default of 25)",
        "type": "integer"
      },
      {
        "name": "skip",
        "in": "query",
        "required": false,
        "description": "Total number of records to skip.",
        "type": "integer"
      },
      {
        "name": "active",
        "in": "query",
        "required": false,
        "description": "Filter by active/inactive memberships",
        "type": "boolean"
      },
      {
        "name": "showAccessBranches",
        "in": "query",
        "required": false,
        "description": "Display the branches that this membership enable access",
        "type": "boolean"
      },
      {
        "name": "showOnlineSalesObservation",
        "in": "query",
        "required": false,
        "description": "Display the observations from online sales",
        "type": "boolean"
      },
      {
        "name": "updateDate",
        "in": "query",
        "required": false,
        "description": "Filter only memberships that have update data greater than or equal: (yyyy-mm-dd)",
        "type": "string",
        "format": "date"
      },
      {
        "name": "showActivitiesGroups",
        "in": "query",
        "required": false,
        "description": "Display the Activities Groups that this membership grants access to",
        "type": "boolean"
      },
      {
        "name": "externalSaleAvailable",
        "in": "query",
        "required": false,
        "description": "",
        "type": "boolean"
      },
      {
        "name": "showSuspensionRules",
        "in": "query",
        "required": false,
        "description": "When true, includes the contractSuspension object with the membership suspension rules",
        "type": "boolean"
      },
      {
        "name": "showCancellationRules",
        "in": "query",
        "required": false,
        "description": "When true, includes the contractCancellation object with the membership cancellation rules",
        "type": "boolean"
      },
      {
        "name": "showContract",
        "in": "query",
        "required": false,
        "description": "When true, includes the htmlContract field with the membership contract template (clauses)",
        "type": "boolean"
      },
      {
        "name": "showTurnstiles",
        "in": "query",
        "required": false,
        "description": "When true, includes the turnstiles field with the turnstiles (catracas) linked to the membership, either directly or through a turnstile group",
        "type": "boolean"
      },
      {
        "name": "showAdditionalMemberships",
        "in": "query",
        "required": false,
        "description": "When true, includes the additionalMemberships array with the add-on memberships linked to each membership — link type (additionalType: Fixed or Optional), configured value and default sale value (def…",
        "type": "boolean"
      }
    ]
  }
];
