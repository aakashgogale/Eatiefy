/**
 * Zones with their own values on a zone-scoped settings page, shown on the
 * all-zones default view. `columns` is [{ field, label, format? }]; a value a
 * zone does not override reads "Default".
 */
export default function ZoneOverridesTable({ rows, columns, zoneNameById, onEdit }) {
  if (!rows?.length) return null
  return (
    <div className="mt-6 rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
        <h3 className="text-sm font-semibold text-slate-900">Zone overrides</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          These zones use their own values; every other zone follows the defaults above.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-3">Zone</th>
              {columns.map(({ field, label }) => (
                <th key={field} className="px-5 py-3">{label}</th>
              ))}
              <th className="px-5 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.zoneId}>
                <td className="px-5 py-3 font-medium text-slate-800">
                  {zoneNameById.get(row.zoneId) || "Unknown zone"}
                </td>
                {columns.map(({ field, format }) => (
                  <td key={field} className="px-5 py-3 text-slate-700">
                    {row[field] != null ? (
                      format ? format(row[field]) : String(row[field])
                    ) : (
                      <span className="text-slate-400">Default</span>
                    )}
                  </td>
                ))}
                <td className="px-5 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => onEdit(row.zoneId)}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
