import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppRoutes } from './AppRoutes';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="users" element={<Users />}>
            <Route path=":userId" element={<UserProfile />} />
          </Route>
          <Route element={<RequireAuth />}>
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="app/*" element={<AppRoutes />} />
          <Route path="old-home" element={<Navigate to="/" />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
