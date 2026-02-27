import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";

import { corsHeaders } from "../lib/headers.ts";
import {
  accountCategories,
  accountDefaults,
  accounts,
  currencies,
  customerStatuses,
  failureModes,
  fiscalYearSettings,
  gaugeTypes,
  groupCompanyTemplate,
  groups,
  nonConformanceRequiredActions,
  nonConformanceTypes,
  paymentTerms,
  scrapReasons,
  sequences,
  supplierStauses,
  unitOfMeasures,
} from "../lib/seed.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import { Database } from "../lib/types.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const { companyId: id, userId } = await req.json();

  console.log({
    function: "seed-company",
    id,
    userId,
  });

  try {
    if (!id) throw new Error("Payload is missing id");
    if (!userId) throw new Error("Payload is missing userId");

    const companyId = id as string;
    const client = await getSupabaseServiceRole(
      req.headers.get("Authorization"),
      req.headers.get("carbon-key") ?? "",
      companyId
    );

    const company = await client
      .from("company")
      .select("*")
      .eq("id", companyId)
      .single();
    if (company.error) throw new Error(company.error.message);
    if (!company.data) throw new Error("Company not found");

    // Determine if this is a new root company or joining an existing group
    let companyGroupId = company.data.companyGroupId;
    const isNewGroup = !companyGroupId;

    await db.transaction().execute(async (trx) => {
      // If no companyGroupId, create a new company group and assign it
      if (isNewGroup) {
        const companyGroupResult = await trx
          .insertInto("companyGroup")
          .values({
            name: company.data.name,
            createdBy: userId,
          })
          .returning(["id"])
          .execute();

        companyGroupId = companyGroupResult[0].id;
        if (!companyGroupId)
          throw new Error("Failed to create company group");

        await trx
          .updateTable("company")
          .set({ companyGroupId })
          .where("id", "=", companyId)
          .execute();
      }

      await trx
        .withSchema("storage")
        .insertInto("buckets")
        .values({
          id: companyId,
          name: companyId,
          public: false,
        })
        .execute();

      await trx
        .insertInto("userToCompany")
        .values([{ userId, companyId, role: "employee" }])
        .execute();

      // high-order groups
      await trx
        .insertInto("group")
        .values(
          groups.map((g) => ({
            ...g,
            id: g.id.replace(
              groupCompanyTemplate,
              `${companyId.substring(0, 4)}-${companyId.substring(
                4,
                8
              )}-${companyId.substring(8, 20)}`
            ),
            companyId,
          }))
        )
        .execute();

      const employeeTypes = await trx
        .insertInto("employeeType")
        .values([
          {
            name: "Admin",
            companyId,
            protected: true,
          },
        ])
        .returning(["id"])
        .execute();

      const employeeTypeId = employeeTypes[0].id;
      if (!employeeTypeId)
        throw new Error("Failed to insert admin employee type");

      // get the modules
      const modules = await trx.selectFrom("modules").select("name").execute() as { name: string }[];

      // create employee type permissions for admin
      const employeeTypePermissions = modules.reduce<
        Database["public"]["Tables"]["employeeTypePermission"]["Insert"][]
      >((acc, module) => {
        if (module.name) {
          acc.push({
            employeeTypeId: employeeTypeId,
            // @ts-expect-error - it's legit, chill typescript
            module: module.name,
            create: [companyId],
            update: [companyId],
            delete: [companyId],
            view: [companyId],
          });
        }
        return acc;
      }, []);

      // insert employee type permissions
      await trx
        .insertInto("employeeTypePermission")
        .values(employeeTypePermissions)
        .execute();

      // insert employee
      await trx
        .insertInto("employee")
        .values([
          {
            id: String(userId),
            employeeTypeId,
            companyId,
            active: true,
          },
        ])
        .execute();

      // supplier status
      await trx
        .insertInto("supplierStatus")
        .values(
          supplierStauses.map((name) => ({
            name,
            companyId,
            createdBy: "system",
          }))
        )
        .execute();

      // customer status
      await trx
        .insertInto("customerStatus")
        .values(
          customerStatuses.map((name) => ({
            name,
            companyId,
            createdBy: "system",
          }))
        )
        .execute();

      // scrap reason codes
      await trx
        .insertInto("scrapReason")
        .values(
          scrapReasons.map((name) => ({
            name,
            companyId,
            createdBy: "system",
          }))
        )
        .execute();

      // payment terms
      await trx
        .insertInto("paymentTerm")
        .values(paymentTerms.map((pt) => ({ ...pt, companyId })))
        .execute();

      await trx
        .insertInto("unitOfMeasure")
        .values(unitOfMeasures.map((uom) => ({ ...uom, companyId })))
        .execute();

      await trx
        .insertInto("gaugeType")
        .values(
          gaugeTypes.map((gt) => ({ name: gt, companyId, createdBy: "system" }))
        )
        .execute();

      await trx
        .insertInto("maintenanceFailureMode")
        .values(failureModes.map((name) => ({ name, companyId, createdBy: "system" })))
        .execute();

      await trx
        .insertInto("nonConformanceType")
        .values(nonConformanceTypes.map((nc) => ({ ...nc, companyId })))
        .execute();

      await trx
        .insertInto("nonConformanceRequiredAction")
        .values(
          nonConformanceRequiredActions.map((nc) => ({ ...nc, companyId }))
        )
        .execute();

      await trx
        .insertInto("sequence")
        .values(sequences.map((s) => ({ ...s, companyId })))
        .execute();

      // Shared tables: only seed for new groups (existing groups already have these)
      if (isNewGroup) {
        await trx
          .insertInto("currency")
          .values(currencies.map((c) => ({ ...c, companyGroupId })))
          .execute();

        const accountCategoriesWithIds = await trx
          .insertInto("accountCategory")
          .values(accountCategories.map((ac) => ({ ...ac, companyGroupId })))
          .returning(["id", "category"])
          .execute();

        const accountCategoriesByName = accountCategoriesWithIds.reduce<
          Record<string, string>
        >((acc, { id, category }) => {
          if (id && category) {
            acc[category] = id;
          }
          return acc;
        }, {});

        const getCategoryId = (category: string | null) => {
          if (!category) return null;
          return accountCategoriesByName[category];
        };

        await trx
          .insertInto("account")
          .values(
            accounts.map(({ accountCategory, ...a }) => ({
              ...a,
              companyGroupId,
              accountCategoryId: getCategoryId(accountCategory),
            }))
          )
          .execute();
      }

      // Company-specific accounting defaults and posting groups
      await trx
        .insertInto("accountDefault")
        .values([
          {
            ...accountDefaults,
            companyId,
            companyGroupId,
          },
        ])
        .execute();

      await trx
        .insertInto("fiscalYearSettings")
        .values([{ ...fiscalYearSettings, companyId }])
        .execute();

      const user = await client
        .from("userPermission")
        .select("permissions")
        .eq("id", userId)
        .single();
      if (user.error) throw new Error(user.error.message);

      const currentPermissions = (user.data?.permissions ?? {}) as Record<
        string,
        string[]
      >;
      const newPermissions = { ...currentPermissions };
      modules.forEach(({ name }) => {
        const module = name?.toLowerCase();
        if (`${module}_view` in newPermissions) {
          newPermissions[`${module}_view`].push(companyId);
        } else {
          newPermissions[`${module}_view`] = [companyId];
        }

        if (`${module}_create` in newPermissions) {
          newPermissions[`${module}_create`].push(companyId);
        } else {
          newPermissions[`${module}_create`] = [companyId];
        }

        if (`${module}_update` in newPermissions) {
          newPermissions[`${module}_update`].push(companyId);
        } else {
          newPermissions[`${module}_update`] = [companyId];
        }

        if (`${module}_delete` in newPermissions) {
          newPermissions[`${module}_delete`].push(companyId);
        } else {
          newPermissions[`${module}_delete`] = [companyId];
        }
      });

      const { error } = await client
        .from("userPermission")
        .update({ permissions: newPermissions })
        .eq("id", userId);
      if (error) throw new Error(error.message);
    });

    return new Response(
      JSON.stringify({
        success: true,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify(err), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
