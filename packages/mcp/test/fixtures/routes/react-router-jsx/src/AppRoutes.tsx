import { Route, Routes } from 'react-router-dom';

export function AppRoutes() {
  return (
    <Routes>
      <Route index element={<AppHome />} />
      <Route path="reports/:reportId" element={<Report />} />
    </Routes>
  );
}
