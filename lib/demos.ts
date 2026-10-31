// Fictional letters. Every person, plan, supplier, address, and number below is invented.

export const DEMOS = [
  {
    id: "clear",
    title: "Power wheelchair denied by Medicare",
    hint: "Missing doctor's visit note. Shows the fix and your deadline.",
    text: `Medicare Durable Medical Equipment Contractor
Notice of Denied Claim

Notice Date: September 14, 2026

Loretta M. Pruitt
418 Sugarloaf Lane, Apt 2C
Lawrenceville, GA 30043

Medicare Number: 1EG4-TE5-MK73
Claim Number: 21626701455000
Date of Birth: 03/22/1951
Phone: (770) 555-0142

Dear Ms. Pruitt:

We reviewed the claim from Peachtree Mobility Supply for a Group 2 power wheelchair (HCPCS K0823), ordered by Dr. Anand Krishnan on July 30, 2026. Medicare cannot pay for this item.

Reason for denial: The records do not include documentation of a face-to-face encounter with the treating practitioner within the 6 months before the written order. Medicare requires this visit note for all power mobility devices.

The standard written order was received and is complete. The records describe a patient with advanced multiple sclerosis who cannot walk inside the home.

Your right to appeal: If you disagree, you may request a redetermination. Your request must be filed within 120 days of the date you receive this notice. Send your request to the address on this notice or call 1-800-MEDICARE.`,
  },
  {
    id: "messy",
    title: "Manual wheelchair denied by Medicaid",
    hint: "Two vague reasons. Asks you one question first.",
    text: `GEORGIA MEDICAID MANAGED CARE
Piedmont Family Health Plan
NOTICE OF ADVERSE BENEFIT DETERMINATION

Date of this notice: 10/06/2026

Member: Darnell Whitfield     Medicaid ID: 667123904512     DOB: 11/02/1988
Re: Request for ultra lightweight manual wheelchair (K0005)

Your request was reviewed and we made the following decision: NOT APPROVED.

Why: Information given to us does not fully support the request under plan guidelines. The evaluation sent to us did not show enough about your functional ability or why a lower level item will not meet your needs. Review of medical need criteria could not be completed.

What you can do: You or someone you choose can ask for an appeal with the plan within 60 calendar days of the date of this notice. After the plan decides, you can ask for a state fair hearing.

Questions? Call Member Services at 1-800-555-0177.`,
  },
  {
    id: "unclear",
    title: "Tilt wheelchair denied by job insurance",
    hint: "No clear reason. Sends you to a free helper.",
    text: `Lakeshore Employers Health Plan
Explanation of Benefits

Date: 08/29/2026

Subscriber: Priya Venkataraman
Member ID: LEH4471902     Group Number: 88213

Dear Priya,

We are unable to approve the item requested by your provider, a tilt-in-space wheelchair (E1161). This decision was based on plan terms and the information available at the time of review. The criteria that apply under your benefit were not met.

The authorization on file could not be matched to this request, and the participating status of the supplier could not be confirmed.

If you believe this is in error, you may send more information. You may appeal within 180 days of receiving this notice.`,
  },
] as const;
