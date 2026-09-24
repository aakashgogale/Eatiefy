import DeliveryV2Router from './DeliveryV2Router';
import RouteErrorBoundary from '@/shared/components/RouteErrorBoundary';
import './deliveryTheme.css';

function DeliveryV2Module() {
	return (
		<RouteErrorBoundary>
			<div className="delivery-v2-theme">
				<DeliveryV2Router />
			</div>
		</RouteErrorBoundary>
	);
}

export default DeliveryV2Module;
