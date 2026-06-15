// The Carbon written user guide — single source of truth for every chapter.
//
// Content is data, not JSX: each chapter is a list of sections, and each section
// is a list of typed blocks. The route files (one per chapter) are thin wrappers
// that look a chapter up by slug and hand it to <GuideChapter/>.
//
// Screenshots ship with src "" first, rendering a placeholder, so the guide is
// fully navigable before any image is captured. Filling them in later is a pure
// data edit: drop a PNG in apps/erp/public/guide/<slug>/... and set the src.

export type GuideBlock =
  | { kind: "prose"; md: string }
  | {
      kind: "callout";
      tone: "note" | "tip" | "warning";
      title?: string;
      md: string;
    }
  | { kind: "steps"; items: string[] }
  | { kind: "spec"; rows: { label: string; value: string }[] }
  | { kind: "screenshot"; src: string; alt: string; caption?: string };

export type GuideSection = {
  id: string; // anchor + scroll-spy id (unique within the chapter)
  fig: string; // "FIG.01" eyebrow
  label: string; // short category label, e.g. "OVERVIEW"
  title: string; // <h2>
  blocks: GuideBlock[];
};

export type Chapter = {
  id: string;
  slug: string; // matches the route filename → /guide/<slug>
  eyebrow: string; // sidebar category, e.g. "MODULE"
  title: string;
  summary: string; // one-liner for the index + meta description
  sections: GuideSection[];
};

// ── Chapters ──────────────────────────────────────────────────────────────

const coreConcepts: Chapter = {
  id: "core-concepts",
  slug: "core-concepts",
  eyebrow: "FOUNDATIONS",
  title: "Core concepts",
  summary:
    "The handful of ideas — items, methods, jobs, locations — that everything else in Carbon builds on.",
  sections: [
    {
      id: "model",
      fig: "FIG.01",
      label: "MODEL",
      title: "How Carbon models your shop",
      blocks: [
        {
          kind: "prose",
          md: "Carbon represents your business as a small set of linked records. Once you understand these, every screen in the product makes sense, because each one is just a view onto one of them."
        },
        {
          kind: "spec",
          rows: [
            {
              label: "Items",
              value:
                "Everything you buy, make, or sell — parts, materials, tools, and consumables."
            },
            {
              label: "Customers & suppliers",
              value:
                "The companies you sell to and buy from, with their contacts, terms, and addresses."
            },
            {
              label: "Documents",
              value:
                "Quotes, sales orders, purchase orders, and invoices — the paperwork that moves goods and money."
            },
            {
              label: "Jobs",
              value:
                "Production orders that turn materials into finished items on the shop floor."
            },
            {
              label: "Inventory",
              value:
                "What you physically have, where it is, and how much is already promised."
            }
          ]
        },
        {
          kind: "screenshot",
          src: "",
          alt: "The Carbon home dashboard with module navigation",
          caption:
            "The home dashboard is your jumping-off point into every module."
        }
      ]
    },
    {
      id: "items-vs-methods",
      fig: "FIG.02",
      label: "MODEL",
      title: "Items vs. methods",
      blocks: [
        {
          kind: "prose",
          md: "An **item** is a *thing* — a bracket, a sheet of aluminum, a finished assembly. A **method** is the *recipe* for making that thing: the materials it consumes (its bill of materials) and the operations it passes through (its routing)."
        },
        {
          kind: "prose",
          md: "Separating the two is what lets Carbon plan. The item tells the system *what* you need; the method tells it *how* to get it — and therefore what materials to buy, what operations to schedule, and what it should cost."
        },
        {
          kind: "callout",
          tone: "tip",
          md: "Every item you manufacture needs at least one method before you can release a job for it. Purchased items don't need a method — they just need a supplier."
        }
      ]
    },
    {
      id: "make-vs-buy",
      fig: "FIG.03",
      label: "PLANNING",
      title: "Make vs. buy",
      blocks: [
        {
          kind: "prose",
          md: "Every item has a **replenishment** setting that answers one question: when you need more of this, do you *make* it or *buy* it? This single choice decides whether a shortage becomes a **job** (for the shop floor) or a **purchase order** (for a supplier)."
        },
        {
          kind: "spec",
          rows: [
            {
              label: "Buy",
              value:
                "Purchased from a supplier. Shortages create purchase order suggestions."
            },
            {
              label: "Make",
              value:
                "Manufactured in-house using the item's method. Shortages create job suggestions."
            },
            {
              label: "Buy and Make",
              value:
                "Either path is valid — useful for items you normally buy but can also produce."
            }
          ]
        }
      ]
    },
    {
      id: "orders-jobs-demand",
      fig: "FIG.04",
      label: "FLOW",
      title: "Orders, jobs & demand",
      blocks: [
        {
          kind: "prose",
          md: "Demand enters Carbon at the top — a customer places a **sales order**, or you forecast future need. Planning explodes that demand down through methods into the materials and operations required, then proposes the **jobs** and **purchase orders** that satisfy it."
        },
        {
          kind: "prose",
          md: "Supply flows back up: purchase orders are received into inventory, jobs consume that inventory and produce finished goods, and those goods ship against the original sales order. Carbon keeps the running balance of supply and demand for every item at every location."
        }
      ]
    },
    {
      id: "locations",
      fig: "FIG.05",
      label: "INVENTORY",
      title: "Locations & inventory",
      blocks: [
        {
          kind: "prose",
          md: "Inventory always lives at a **location** (a building or warehouse) and, optionally, on a **shelf** within it. Carbon tracks several quantities for each item at each location so you always know what is truly available."
        },
        {
          kind: "spec",
          rows: [
            { label: "On hand", value: "Physically present and counted." },
            {
              label: "Reserved",
              value:
                "Already promised to a sales order or job — not free to use."
            },
            {
              label: "On order",
              value: "Inbound on an open purchase order, not yet received."
            },
            {
              label: "On jobs",
              value: "Being produced, available once the job completes."
            }
          ]
        }
      ]
    },
    {
      id: "permissions",
      fig: "FIG.06",
      label: "ACCESS",
      title: "Permissions & companies",
      blocks: [
        {
          kind: "prose",
          md: "All of your data is scoped to a **company**. A single login can belong to more than one company — handy for separate divisions or demo environments. Inside a company, each employee has a **role** that grants view / create / update / delete permissions per module, so people only see what their job requires."
        }
      ]
    }
  ]
};

const gettingStarted: Chapter = {
  id: "getting-started",
  slug: "getting-started",
  eyebrow: "SETUP",
  title: "Getting started",
  summary:
    "Stand up a working company from scratch: team, locations, defaults, and your first part.",
  sections: [
    {
      id: "company",
      fig: "FIG.01",
      label: "SETUP",
      title: "Create your company",
      blocks: [
        {
          kind: "prose",
          md: "Your company is the container for everything else. During onboarding you'll set its name, currency, and address. These become the defaults that flow onto every quote, order, and invoice, so it's worth getting them right up front."
        },
        {
          kind: "screenshot",
          src: "",
          alt: "Company settings page"
        }
      ]
    },
    {
      id: "team",
      fig: "FIG.02",
      label: "PEOPLE",
      title: "Invite your team & set roles",
      blocks: [
        {
          kind: "prose",
          md: "Add the people who'll use Carbon and give each one a role. Roles control what someone can see and do — an operator on the shop floor needs very different access from a buyer or a controller."
        },
        {
          kind: "steps",
          items: [
            "Open **Settings → Users** and choose to invite a new user.",
            "Enter their email and pick the role that matches their job.",
            "Send the invite — they'll set their own password on first sign-in.",
            "Adjust per-module permissions later if a role needs fine-tuning."
          ]
        }
      ]
    },
    {
      id: "locations",
      fig: "FIG.03",
      label: "INVENTORY",
      title: "Set up locations & shelves",
      blocks: [
        {
          kind: "prose",
          md: "Create a **location** for each building or warehouse that holds stock. Within a location, **shelves** give you bin-level detail so pickers and operators know exactly where to find material."
        },
        {
          kind: "callout",
          tone: "note",
          md: "You can run Carbon with a single location and no shelves to start, then add detail as your operation grows."
        }
      ]
    },
    {
      id: "sequences",
      fig: "FIG.04",
      label: "DEFAULTS",
      title: "Number sequences & defaults",
      blocks: [
        {
          kind: "prose",
          md: "Carbon auto-numbers documents — quotes, orders, jobs, invoices — using **sequences** you control. Set the prefix and starting number once and every new document follows the pattern. While you're in settings, review default units of measure, payment terms, and shipping methods so they prefill correctly."
        }
      ]
    },
    {
      id: "import",
      fig: "FIG.05",
      label: "DATA",
      title: "Import items, customers & suppliers",
      blocks: [
        {
          kind: "prose",
          md: "Rather than typing everything by hand, import your existing catalog and contacts. Carbon accepts spreadsheet uploads for items, customers, and suppliers, mapping your columns to its fields so you can go live with real data quickly."
        }
      ]
    },
    {
      id: "first-part",
      fig: "FIG.06",
      label: "MILESTONE",
      title: "Create your first part",
      blocks: [
        {
          kind: "prose",
          md: "With the basics in place, create one real part end-to-end. It's the fastest way to see how the pieces connect — and a natural lead-in to the **Items** chapter next."
        },
        {
          kind: "steps",
          items: [
            "Go to the **Items** module and add a new part.",
            "Give it a readable name and part number.",
            "Set its replenishment to **Make** or **Buy**.",
            "If it's a make part, add a simple method with one material and one operation.",
            "Save — you now have something you can quote, order, and produce."
          ]
        }
      ]
    }
  ]
};

const items: Chapter = {
  id: "items",
  slug: "items",
  eyebrow: "MODULE",
  title: "Items & Parts",
  summary:
    "Your catalog: parts, materials, tools, and consumables — plus revisions, costing, and tracking.",
  sections: [
    {
      id: "types",
      fig: "FIG.01",
      label: "REFERENCE",
      title: "Item types",
      blocks: [
        {
          kind: "prose",
          md: "Everything in your catalog is an *item*, but items come in a few flavors that behave differently in planning and on the shop floor."
        },
        {
          kind: "spec",
          rows: [
            {
              label: "Part",
              value:
                "Something you design, make, or sell — finished goods and sub-assemblies."
            },
            {
              label: "Material",
              value: "Raw stock and components consumed by jobs."
            },
            {
              label: "Tool",
              value: "Reusable tooling and fixtures the shop tracks."
            },
            {
              label: "Consumable",
              value:
                "Low-value supplies not tracked individually, like adhesive or gloves."
            }
          ]
        }
      ]
    },
    {
      id: "create",
      fig: "FIG.02",
      label: "HOW-TO",
      title: "Creating a part",
      blocks: [
        {
          kind: "prose",
          md: "A part record holds everything Carbon needs to plan, cost, and produce it. The essentials are a name, a part number, a unit of measure, and a replenishment setting; everything else can be filled in over time."
        },
        {
          kind: "screenshot",
          src: "",
          alt: "Creating a new part",
          caption: "The new-part form with name, number, and replenishment."
        }
      ]
    },
    {
      id: "revisions",
      fig: "FIG.03",
      label: "HOW-TO",
      title: "Working with revisions",
      blocks: [
        {
          kind: "prose",
          md: "Parts change over time. **Revisions** let you keep multiple versions of the same part so historical orders and jobs stay tied to the version they actually used, while new work picks up the latest."
        },
        {
          kind: "steps",
          items: [
            "Open the part and switch to its **Revisions**.",
            "Create a new revision from the current one.",
            "Update the method or properties on the new revision.",
            "Make the revision active when it's ready for production."
          ]
        },
        {
          kind: "callout",
          tone: "warning",
          md: "Old revisions are never deleted — that's the point. A job created last year still references the exact revision it was built from."
        }
      ]
    },
    {
      id: "uom-costing",
      fig: "FIG.04",
      label: "DETAIL",
      title: "Units of measure & costing",
      blocks: [
        {
          kind: "prose",
          md: "Each item has a base **unit of measure** (each, kg, ft, …). You can also define purchasing units so you buy in cases but track in pieces, and Carbon converts between them. Cost is rolled up from the item's materials and operations, giving you a live unit cost as your methods change."
        }
      ]
    },
    {
      id: "tracking",
      fig: "FIG.05",
      label: "TRACEABILITY",
      title: "Tracking & serialization",
      blocks: [
        {
          kind: "prose",
          md: "Items can be tracked by **batch/lot** or **serial number**. When tracking is on, Carbon records the genealogy of every unit — which supplier batch it came from and which finished part it ended up in — which is what makes recalls and quality investigations possible."
        }
      ]
    }
  ]
};

const customersSuppliers: Chapter = {
  id: "customers-and-suppliers",
  slug: "customers-and-suppliers",
  eyebrow: "MODULE",
  title: "Customers & Suppliers",
  summary:
    "Your trading partners — contacts, parts, lead times, and the terms that prefill onto documents.",
  sections: [
    {
      id: "customers",
      fig: "FIG.01",
      label: "SALES",
      title: "Customers & contacts",
      blocks: [
        {
          kind: "prose",
          md: "A **customer** record holds the company you sell to: its addresses, contacts, payment terms, and shipping preferences. Those defaults flow onto every quote and sales order, so you set them once instead of on each document."
        },
        {
          kind: "screenshot",
          src: "",
          alt: "Customer record with contacts and terms"
        }
      ]
    },
    {
      id: "customer-parts",
      fig: "FIG.02",
      label: "SALES",
      title: "Customer part numbers",
      blocks: [
        {
          kind: "prose",
          md: "Customers often refer to your parts by *their* part number. Map their number to yours on the customer record and Carbon will recognize it on incoming orders and print it on documents the customer receives."
        }
      ]
    },
    {
      id: "suppliers",
      fig: "FIG.03",
      label: "PURCHASING",
      title: "Suppliers & contacts",
      blocks: [
        {
          kind: "prose",
          md: "A **supplier** record mirrors a customer, but for the companies you buy from. It carries their contacts, payment terms, currency, and shipping origin — everything purchasing needs to raise an order."
        }
      ]
    },
    {
      id: "supplier-parts",
      fig: "FIG.04",
      label: "PURCHASING",
      title: "Supplier parts & lead times",
      blocks: [
        {
          kind: "prose",
          md: "Link the items a supplier provides to their pricing, minimum order quantities, and **lead time**. Planning uses lead time to work backwards from when you need material to when you must place the order, so purchase suggestions arrive with enough runway."
        }
      ]
    }
  ]
};

const sales: Chapter = {
  id: "sales",
  slug: "sales",
  eyebrow: "MODULE",
  title: "Sales",
  summary:
    "Quote to order to ship: build quotes, win them, and turn them into sales orders you can fulfill.",
  sections: [
    {
      id: "rfqs",
      fig: "FIG.01",
      label: "SALES",
      title: "Sales RFQs",
      blocks: [
        {
          kind: "prose",
          md: "When a customer asks for pricing, you can capture their request as a **sales RFQ** and turn it straight into a quote — keeping the original ask attached for context."
        }
      ]
    },
    {
      id: "quotes",
      fig: "FIG.02",
      label: "HOW-TO",
      title: "Building & sending a quote",
      blocks: [
        {
          kind: "prose",
          md: "A **quote** is a priced proposal. Add lines for the parts the customer wants, set quantities and prices, and Carbon can cost each line from its method so your margins are visible as you build it. You can offer quantity breaks and per-line discounts."
        },
        {
          kind: "steps",
          items: [
            "Create a quote and choose the customer.",
            "Add a line per part, with quantity and price.",
            "Optionally add quantity breaks for volume pricing.",
            "Send the quote by email or share a live link the customer can open in their browser."
          ]
        },
        {
          kind: "screenshot",
          src: "",
          alt: "A quote with priced lines",
          caption: "Quote lines with pricing and margin."
        }
      ]
    },
    {
      id: "convert",
      fig: "FIG.03",
      label: "FLOW",
      title: "Converting a quote",
      blocks: [
        {
          kind: "prose",
          md: "When the customer accepts, convert the quote into a **sales order** in one step. Pricing and lines carry over, so nothing is re-keyed and the order is traceable back to the quote it came from."
        }
      ]
    },
    {
      id: "sales-orders",
      fig: "FIG.04",
      label: "HOW-TO",
      title: "Sales orders",
      blocks: [
        {
          kind: "prose",
          md: "A **sales order** is a committed promise to deliver. It creates demand: if the parts are in stock you can ship right away, otherwise planning proposes the jobs or purchase orders needed to fulfill it. The order moves through statuses from *To Ship* through *To Invoice* to *Invoiced*."
        }
      ]
    },
    {
      id: "fulfillment",
      fig: "FIG.05",
      label: "FLOW",
      title: "Fulfillment & shipping",
      blocks: [
        {
          kind: "prose",
          md: "When goods are ready, pick and ship against the order. Shipping reduces inventory, records the dispatch, and advances the order toward invoicing. Invoicing itself is covered in the **Accounting** chapter."
        }
      ]
    }
  ]
};

const purchasing: Chapter = {
  id: "purchasing",
  slug: "purchasing",
  eyebrow: "MODULE",
  title: "Purchasing",
  summary:
    "Source and receive material: RFQs, supplier quotes, purchase orders, and receipts.",
  sections: [
    {
      id: "rfqs",
      fig: "FIG.01",
      label: "PURCHASING",
      title: "Purchasing RFQs & supplier quotes",
      blocks: [
        {
          kind: "prose",
          md: "Ask one or more suppliers for pricing with a **purchasing RFQ**, then capture what comes back as **supplier quotes**. Comparing quotes side by side helps you pick the right source before committing."
        }
      ]
    },
    {
      id: "purchase-orders",
      fig: "FIG.02",
      label: "HOW-TO",
      title: "Purchase orders",
      blocks: [
        {
          kind: "prose",
          md: "A **purchase order** is your commitment to buy. Add the items, quantities, and promised dates; Carbon carries supplier pricing, currency, and unit conversions automatically. Open POs show up as inbound supply in planning."
        },
        {
          kind: "steps",
          items: [
            "Create a PO and choose the supplier.",
            "Add lines for the items and quantities you need.",
            "Confirm dates and pricing, then issue the order.",
            "Send it to the supplier directly from Carbon."
          ]
        },
        {
          kind: "screenshot",
          src: "",
          alt: "A purchase order with lines"
        }
      ]
    },
    {
      id: "receiving",
      fig: "FIG.03",
      label: "FLOW",
      title: "Receiving",
      blocks: [
        {
          kind: "prose",
          md: "When material arrives, record a **receipt** against the PO. Quantities are added to inventory at the receiving location, tracked items get their batch or serial recorded, and the PO advances toward invoicing. A supplier invoice can then be matched against the PO and receipt before payment."
        }
      ]
    }
  ]
};

const inventory: Chapter = {
  id: "inventory",
  slug: "inventory",
  eyebrow: "MODULE",
  title: "Inventory",
  summary:
    "Know what you have and where: locations, shelves, availability, kanban, and adjustments.",
  sections: [
    {
      id: "locations",
      fig: "FIG.01",
      label: "STRUCTURE",
      title: "Locations & shelves",
      blocks: [
        {
          kind: "prose",
          md: "Inventory is organized by **location** and **shelf**. The Inventory module shows on-hand quantities rolled up by item, drillable down to the exact shelf, so you can answer *what do we have and where* instantly."
        },
        {
          kind: "screenshot",
          src: "",
          alt: "Inventory levels by location"
        }
      ]
    },
    {
      id: "availability",
      fig: "FIG.02",
      label: "CONCEPT",
      title: "On-hand vs. available",
      blocks: [
        {
          kind: "prose",
          md: "*On hand* is what's physically there; *available* is what's actually free to use after subtracting quantities reserved for sales orders and jobs. Watching available — not just on hand — is what keeps you from promising stock twice."
        }
      ]
    },
    {
      id: "transfers",
      fig: "FIG.03",
      label: "HOW-TO",
      title: "Stock & warehouse transfers",
      blocks: [
        {
          kind: "prose",
          md: "Move material between shelves or between locations with a **transfer**. Carbon records the movement in the item ledger so on-hand stays accurate everywhere and you keep a full audit trail of where stock has been."
        }
      ]
    },
    {
      id: "kanban",
      fig: "FIG.04",
      label: "AUTOMATION",
      title: "Kanban & reorder points",
      blocks: [
        {
          kind: "prose",
          md: "**Kanbans** automate replenishment for parts you restock regularly. Each kanban carries a fixed reorder quantity and can print a QR code; scanning it on the floor can automatically raise the job or purchase order to refill the bin — no manual planning needed."
        },
        {
          kind: "callout",
          tone: "tip",
          md: "Kanban is ideal for high-runner materials. Pair it with reorder points so routine restocking happens without anyone watching stock levels."
        }
      ]
    },
    {
      id: "counts",
      fig: "FIG.05",
      label: "HOW-TO",
      title: "Counts & adjustments",
      blocks: [
        {
          kind: "prose",
          md: "Reconcile the system to reality with counts and adjustments. Every change writes to the **item ledger**, the immutable history of all inventory movements, so you can always explain how a quantity got to where it is."
        }
      ]
    }
  ]
};

const production: Chapter = {
  id: "production",
  slug: "production",
  eyebrow: "MODULE",
  title: "Production & Methods",
  summary:
    "Define how parts are made and run the jobs that make them — methods, BOMs, routing, and scheduling.",
  sections: [
    {
      id: "methods",
      fig: "FIG.01",
      label: "CONCEPT",
      title: "Methods & the bill of materials",
      blocks: [
        {
          kind: "prose",
          md: "A **method** is how a part is made. Its **bill of materials (BOM)** lists every material the part consumes, with quantities. BOMs can be multi-level: a part needs a sub-assembly, which needs its own materials — Carbon explodes the whole tree during planning."
        },
        {
          kind: "spec",
          rows: [
            {
              label: "Make",
              value: "A sub-component produced by its own method and job."
            },
            { label: "Pick", value: "Taken from inventory on hand." },
            { label: "Buy", value: "Purchased specifically for this method." }
          ]
        },
        {
          kind: "screenshot",
          src: "",
          alt: "A method with its bill of materials"
        }
      ]
    },
    {
      id: "routing",
      fig: "FIG.02",
      label: "CONCEPT",
      title: "Routing, work centers & operations",
      blocks: [
        {
          kind: "prose",
          md: "The **routing** is the sequence of **operations** a part passes through, each performed at a **work center** — a machine or area like a CNC mill, a paint booth, or an assembly bench. Each operation carries setup, labor, and machine times that feed both scheduling and cost."
        }
      ]
    },
    {
      id: "make-vs-buy",
      fig: "FIG.03",
      label: "PLANNING",
      title: "Make vs. buy on the BOM",
      blocks: [
        {
          kind: "prose",
          md: "Each material line inherits whether it is made, picked, or bought. Getting this right is what lets a single job description fan out correctly into sub-jobs for the things you make and purchase orders for the things you buy."
        }
      ]
    },
    {
      id: "jobs",
      fig: "FIG.04",
      label: "HOW-TO",
      title: "Jobs / production orders",
      blocks: [
        {
          kind: "prose",
          md: "A **job** is an order to make a specific quantity of a part by a due date. It snapshots the part's method, so the materials and operations are locked in even if the method changes later. Jobs progress from *Planned* to *Ready* to *In Progress* and finally *Complete*."
        },
        {
          kind: "steps",
          items: [
            "Create a job for a make part and set the quantity and due date.",
            "Review the materials and operations pulled from the method.",
            "Release the job so it appears on the shop floor.",
            "Track progress as operators complete operations in the MES."
          ]
        }
      ]
    },
    {
      id: "scheduling",
      fig: "FIG.05",
      label: "FLOW",
      title: "Releasing & scheduling",
      blocks: [
        {
          kind: "prose",
          md: "Releasing a job makes its operations available to operators and reserves its materials. Scheduling lays those operations across work centers and time so you can see load, spot bottlenecks, and commit to realistic dates."
        }
      ]
    }
  ]
};

const mes: Chapter = {
  id: "mes",
  slug: "mes",
  eyebrow: "APP",
  title: "MES / Shop floor",
  summary:
    "The operator app where work actually happens: clock on, report quantities, and capture data.",
  sections: [
    {
      id: "operator-app",
      fig: "FIG.01",
      label: "OVERVIEW",
      title: "The operator app",
      blocks: [
        {
          kind: "prose",
          md: "The **MES** is Carbon's shop-floor app, built for operators rather than office staff. It shows the operations ready to run, in a touch-friendly interface designed for a tablet or terminal next to the machine."
        },
        {
          kind: "screenshot",
          src: "",
          alt: "The MES operator dashboard"
        }
      ]
    },
    {
      id: "clocking",
      fig: "FIG.02",
      label: "HOW-TO",
      title: "Clocking on & off operations",
      blocks: [
        {
          kind: "prose",
          md: "Operators **clock on** to an operation when they start and **off** when they pause or finish. This captures real labor and machine time against the job, which is what turns planned cost into actual cost."
        }
      ]
    },
    {
      id: "reporting",
      fig: "FIG.03",
      label: "HOW-TO",
      title: "Reporting quantities & scrap",
      blocks: [
        {
          kind: "prose",
          md: "As work completes, operators report **good quantity** and any **scrap** or rework. Carbon advances the operation, moves finished quantity to the next step, and updates the job's progress in real time so the office sees status without asking."
        }
      ]
    },
    {
      id: "traceability",
      fig: "FIG.04",
      label: "QUALITY",
      title: "Shop-floor traceability",
      blocks: [
        {
          kind: "prose",
          md: "Where items are tracked, the floor records which material batches and serials were consumed and which were produced. That genealogy is captured at the moment of work, so the traceability record is a byproduct of doing the job rather than extra paperwork."
        }
      ]
    }
  ]
};

const quality: Chapter = {
  id: "quality",
  slug: "quality",
  eyebrow: "MODULE",
  title: "Quality",
  summary:
    "Catch, investigate, and prevent problems: issues, corrective actions, risk, and genealogy.",
  sections: [
    {
      id: "issues",
      fig: "FIG.01",
      label: "HOW-TO",
      title: "Issues & non-conformances",
      blocks: [
        {
          kind: "prose",
          md: "When something goes wrong — a defect, a customer complaint, a process slip — log it as an **issue**. The issue ties the problem to the items, jobs, or suppliers involved and tracks it through investigation to closure."
        },
        {
          kind: "screenshot",
          src: "",
          alt: "A quality issue record"
        }
      ]
    },
    {
      id: "scar",
      fig: "FIG.02",
      label: "FLOW",
      title: "Corrective actions (SCAR)",
      blocks: [
        {
          kind: "prose",
          md: "For problems that need a supplier or internal fix, raise a **corrective action**. It drives a structured investigation — root cause, action, verification — and can be shared with a supplier so the loop is closed and documented."
        }
      ]
    },
    {
      id: "risk",
      fig: "FIG.03",
      label: "CONCEPT",
      title: "The risk register",
      blocks: [
        {
          kind: "prose",
          md: "The **risk register** is where you record and rate the risks across your operation, so recurring problems get visibility and ownership before they become failures. It turns one-off issues into a managed, prioritized list."
        }
      ]
    },
    {
      id: "genealogy",
      fig: "FIG.04",
      label: "TRACEABILITY",
      title: "Traceability & genealogy",
      blocks: [
        {
          kind: "prose",
          md: "Because tracked items carry their full genealogy, you can trace *forward* (where did this supplier batch end up?) and *backward* (what's inside this finished serial number?). That's the foundation for fast, contained recalls and audit-ready compliance."
        }
      ]
    }
  ]
};

const mrp: Chapter = {
  id: "mrp",
  slug: "mrp",
  eyebrow: "MODULE",
  title: "MRP / Planning",
  summary:
    "How Carbon balances supply and demand and turns shortages into jobs and purchase orders.",
  sections: [
    {
      id: "how-it-works",
      fig: "FIG.01",
      label: "CONCEPT",
      title: "How planning works",
      blocks: [
        {
          kind: "prose",
          md: "**MRP** (material requirements planning) looks at every source of demand and supply, explodes make items down through their methods, and calculates what's short. It then proposes the **jobs** and **purchase orders** that would bring everything back into balance."
        }
      ]
    },
    {
      id: "sources",
      fig: "FIG.02",
      label: "INPUTS",
      title: "Demand & supply sources",
      blocks: [
        {
          kind: "spec",
          rows: [
            {
              label: "Demand",
              value: "Sales orders, job material requirements, and forecasts."
            },
            {
              label: "Supply",
              value: "On-hand inventory, open purchase orders, and open jobs."
            }
          ]
        }
      ]
    },
    {
      id: "running",
      fig: "FIG.03",
      label: "HOW-TO",
      title: "Running planning & acting on suggestions",
      blocks: [
        {
          kind: "prose",
          md: "Planning runs automatically on a schedule and can be triggered on demand. It produces **suggestions** — proposed jobs and POs with quantities and dates. You review them, adjust as needed, and convert the ones you approve into real orders in a click."
        },
        {
          kind: "callout",
          tone: "note",
          md: "Suggestions are proposals, not commitments. Nothing is ordered or scheduled until you accept it."
        }
      ]
    }
  ]
};

const accounting: Chapter = {
  id: "accounting",
  slug: "accounting",
  eyebrow: "MODULE",
  title: "Accounting",
  summary:
    "The financial side: invoices, journals, costing, and how transactions post to the ledger.",
  sections: [
    {
      id: "sales-invoices",
      fig: "FIG.01",
      label: "FLOW",
      title: "Sales invoices",
      blocks: [
        {
          kind: "prose",
          md: "Once goods ship, raise a **sales invoice** to bill the customer. It pulls quantities and pricing from the order, so billing matches what was actually delivered, and it posts revenue and receivables to the ledger."
        }
      ]
    },
    {
      id: "purchase-invoices",
      fig: "FIG.02",
      label: "FLOW",
      title: "Purchase invoices",
      blocks: [
        {
          kind: "prose",
          md: "Supplier bills become **purchase invoices**, matched against the purchase order and receipt before they're approved for payment. Three-way matching catches discrepancies between what you ordered, received, and were billed."
        }
      ]
    },
    {
      id: "journals",
      fig: "FIG.03",
      label: "CONCEPT",
      title: "Journals & postings",
      blocks: [
        {
          kind: "prose",
          md: "Carbon posts ledger entries automatically as the business runs — receiving, shipping, and invoicing each generate the right journal entries against your **chart of accounts**. You can also integrate with accounting software so the financial picture stays in sync."
        }
      ]
    },
    {
      id: "costing",
      fig: "FIG.04",
      label: "CONCEPT",
      title: "Costing & valuation",
      blocks: [
        {
          kind: "prose",
          md: "Inventory carries a cost that flows through every transaction, so your stock is always valued and the cost of goods sold is captured as jobs complete and orders ship. Method roll-ups keep item costs current as materials and operations change."
        }
      ]
    }
  ]
};

const settings: Chapter = {
  id: "settings",
  slug: "settings",
  eyebrow: "ADMIN",
  title: "Settings",
  summary:
    "Configure Carbon for your business: company, users, defaults, and integrations.",
  sections: [
    {
      id: "company",
      fig: "FIG.01",
      label: "ADMIN",
      title: "Company settings",
      blocks: [
        {
          kind: "prose",
          md: "Company settings hold your name, currency, addresses, and branding — the defaults that appear across documents. Update them here and the change ripples through new quotes, orders, and invoices."
        }
      ]
    },
    {
      id: "users-roles",
      fig: "FIG.02",
      label: "ACCESS",
      title: "Users, roles & permissions",
      blocks: [
        {
          kind: "prose",
          md: "Manage who has access and what they can do. Roles bundle per-module permissions (view, create, update, delete) so you can onboard a new hire by picking a role rather than ticking dozens of boxes."
        }
      ]
    },
    {
      id: "defaults",
      fig: "FIG.03",
      label: "DEFAULTS",
      title: "Sequences & defaults",
      blocks: [
        {
          kind: "prose",
          md: "Control document numbering, units of measure, payment and shipping terms, and other defaults that prefill onto new records. Setting these well removes friction from everyday data entry."
        }
      ]
    },
    {
      id: "integrations",
      fig: "FIG.04",
      label: "EXTEND",
      title: "Integrations & API keys",
      blocks: [
        {
          kind: "prose",
          md: "Connect Carbon to the rest of your stack with API keys and integrations — including the **MCP server**, which lets AI assistants drive Carbon in plain language. See the dedicated MCP docs for setup."
        }
      ]
    }
  ]
};

const workflows: Chapter = {
  id: "workflows",
  slug: "workflows",
  eyebrow: "END-TO-END",
  title: "End-to-end workflows",
  summary:
    "Three complete journeys that tie the modules together: quote-to-cash, make-a-part, and procure-to-pay.",
  sections: [
    {
      id: "quote-to-cash",
      fig: "FIG.01",
      label: "WORKFLOW",
      title: "Quote to cash",
      blocks: [
        {
          kind: "prose",
          md: "The full sales journey, from a customer's request to money in the bank."
        },
        {
          kind: "steps",
          items: [
            "Capture the request and build a **quote** with priced lines.",
            "Send it; when the customer accepts, convert it to a **sales order**.",
            "Fulfill from stock, or let planning raise the **jobs** and **POs** to make/buy what's short.",
            "**Ship** the goods against the order.",
            "Raise the **sales invoice** and collect payment."
          ]
        }
      ]
    },
    {
      id: "make-a-part",
      fig: "FIG.02",
      label: "WORKFLOW",
      title: "Make a part",
      blocks: [
        {
          kind: "prose",
          md: "From design to a finished part on the dock."
        },
        {
          kind: "steps",
          items: [
            "Create the **part** and define its **method** — BOM plus routing.",
            "Create and release a **job** for the quantity you need.",
            "Operators run the **operations** in the MES, reporting quantity and scrap.",
            "Materials are consumed and finished goods land in **inventory**.",
            "Ship or stock the part — its full **genealogy** is recorded along the way."
          ]
        }
      ]
    },
    {
      id: "procure-to-pay",
      fig: "FIG.03",
      label: "WORKFLOW",
      title: "Procure to pay",
      blocks: [
        {
          kind: "prose",
          md: "Sourcing material and settling the bill."
        },
        {
          kind: "steps",
          items: [
            "Identify the need — manually or from a planning **suggestion**.",
            "Optionally RFQ suppliers and compare **supplier quotes**.",
            "Issue a **purchase order** to the chosen supplier.",
            "**Receive** the goods into inventory when they arrive.",
            "Match the **purchase invoice** to the PO and receipt, then pay."
          ]
        }
      ]
    }
  ]
};

const glossary: Chapter = {
  id: "glossary",
  slug: "glossary",
  eyebrow: "REFERENCE",
  title: "Glossary",
  summary: "Plain-language definitions of the terms used throughout Carbon.",
  sections: [
    {
      id: "terms",
      fig: "FIG.01",
      label: "REFERENCE",
      title: "Terms & definitions",
      blocks: [
        {
          kind: "spec",
          rows: [
            {
              label: "Item",
              value:
                "Anything you buy, make, or sell — part, material, tool, or consumable."
            },
            {
              label: "Method",
              value:
                "The recipe for making an item: its bill of materials plus routing."
            },
            {
              label: "BOM",
              value:
                "Bill of materials — the list of materials an item consumes."
            },
            {
              label: "Routing",
              value: "The ordered operations an item passes through to be made."
            },
            {
              label: "Operation",
              value: "A single step in a routing, run at a work center."
            },
            {
              label: "Work center",
              value: "A machine or area where operations are performed."
            },
            {
              label: "Job",
              value:
                "A production order to make a quantity of a part by a date."
            },
            {
              label: "Replenishment",
              value: "Whether an item is made or bought when more is needed."
            },
            {
              label: "Sales order",
              value: "A customer's committed order, creating demand."
            },
            {
              label: "Purchase order",
              value: "Your committed order to a supplier, creating supply."
            },
            {
              label: "MRP",
              value:
                "Planning that balances supply and demand into suggestions."
            },
            {
              label: "Kanban",
              value:
                "An automatic reorder signal for routinely restocked items."
            },
            {
              label: "Tracked entity",
              value: "A specific batch or serial carrying its own genealogy."
            },
            {
              label: "Item ledger",
              value: "The immutable history of every inventory movement."
            }
          ]
        }
      ]
    }
  ]
};

export const CHAPTERS: Chapter[] = [
  coreConcepts,
  gettingStarted,
  items,
  customersSuppliers,
  sales,
  purchasing,
  inventory,
  production,
  mes,
  quality,
  mrp,
  accounting,
  settings,
  workflows,
  glossary
];

export const getChapter = (slug: string) =>
  CHAPTERS.find((c) => c.slug === slug);

export const chapterTOC = (c: Chapter) =>
  c.sections.map((s) => ({ id: s.id, label: s.title }));
