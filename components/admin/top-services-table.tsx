import type { TopService } from "@/lib/services/analytics";

export function TopServicesTable({ services }: { services: TopService[] }) {
  if (services.length === 0) {
    return <p className="text-sm text-slate-500">No orders in this period yet.</p>;
  }

  return (
    <table className="w-full text-left text-sm">
      <thead className="text-slate-500">
        <tr>
          <th className="pb-2 font-medium">Service</th>
          <th className="pb-2 text-right font-medium">Orders</th>
          <th className="pb-2 text-right font-medium">Revenue</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-800">
        {services.map((s) => (
          <tr key={s.serviceId}>
            <td className="py-2 text-slate-200">{s.name}</td>
            <td className="py-2 text-right text-slate-400">{s.orderCount}</td>
            <td className="py-2 text-right text-slate-400">${s.revenue.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
